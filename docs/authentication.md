# 認証設計 (指示書10章)

> **稼働開始時点で有効なログイン方法は LINE のみです。** メールOTP・千ノ国パスポートSSO・
> 代理店SSOは実装または接続が未了のため既定で閉じています (`docs/login-methods.md`)。
> 以下の記述は各方式の実装内容であり、本番で利用できることを意味しません。



## OVE独自セッション

- `packages/auth/src/session.ts` の `issueSession()` がセッショントークン (256bit乱数) を発行。
- Cookie名: `ove_session` (ユーザー) / `ove_admin_session` (管理者)。
- Cookie属性: `HttpOnly`, `Secure`, `SameSite=Lax`。認証トークンをLocalStorageへは保存しない。
- DBには `sessionTokenHash` (SHA-256の決定的ハッシュ) のみ保存し、平文トークンは保存しない。
- 本人向けAPI (`GET /api/v1/me/wallet`, `/me/transactions`, `/me/transactions/{id}`) は
  `SessionAuthGuard` でこのセッションを検証し、`req.account.id` から本人のOVEアカウントを
  特定する。URLで `oveAccountId` を受け取らないため、他人の残高・取引を推測URLで
  参照することはできない (開発ガイドライン12.1章に対応。`docs/external-api.md` 参照)。
- 2026-07-19: ログイン時に接続元の`ip_address`/`user_agent`を`user_sessions`へ記録する
  ようにした (ユーザー向けログインデバイス一覧向け、`docs/login-devices.md`参照)。
  `SessionAuthGuard`は検証済みセッションIDを`req.sessionId`に積み、「この端末」判定に使う。

## メールワンタイムコード

`packages/auth/src/email-otp.ts` の `EmailOtpService`:

- 6桁 / 有効期限10分 / 入力上限5回 / 再送間隔60秒 / 最新コードのみ有効。
- コードは scrypt でハッシュ化して保存 (平文保存禁止)。
- 保存先は Redis (`REDIS_URL` 未設定時はインメモリstoreへフォールバック。
  `packages/auth/src/kv-store.ts`)。

## LINEログイン

`packages/auth/src/sso.ts` の `LineAuthVerifier` インターフェースに対し、以下の2実装がある。

- `MockLineAuthVerifier` (開発・テスト用、`mock.<lineUserId>` 形式のIDトークンを検証)。
- `LineIdTokenVerifier` (本番実装)。LINEの「IDトークン検証」API
  (`POST https://api.line.me/oauth2/v2.1/verify`) へ `id_token`/`client_id` を渡し、
  LINE側で署名検証済みのクレーム (`sub`/`email`/`aud`) を受け取る方式。JWKSを自前で
  取得・検証する方式は採用していない (署名アルゴリズムの選択・鍵ローテーション対応を
  LINE側に委ね、自前実装による検証バイパスのリスクを避けるため)。

`apps/api/src/auth/auth.service.ts` は `AUTH_MODE=production` かつ `LINE_CHANNEL_ID` が
設定されている場合のみ `LineIdTokenVerifier` を使い、それ以外は `MockLineAuthVerifier` を
使う。`AUTH_MODE=production` で `LINE_CHANNEL_ID` が空の場合は起動時ではなくクラス構築時に
例外を投げる (安全側に倒し、無認証で通ってしまうことを防ぐ)。

単体テスト (`packages/auth/src/line.test.ts`、`fetch`をモック化) に加え、実チャネルでの
結合試験(2026-07-18、`AUTH_MODE=production`・実LIFFアプリ・実LINEアカウント)でも
実際のIDトークン検証→アカウント作成→ウォレット画面表示までの動作を確認済み。LINEから
受け取ったプロフィールをそのまま信用しない方針(サーバー側検証必須)は維持している。

### 検証失敗時のエラーハンドリング (2026-07-19修正)

`LineAuthVerifier.verifyIdToken()` (および同様に `SengokuSsoService.exchangeCode()`・
`AgencySsoVerifier.verify()`) は、期限切れ・無効なトークン等の検証失敗時に素の`Error`を
投げる実装だった。これを呼び出し元 (`auth.service.ts`) で捕捉していなかったため、
NestJSのデフォルト処理で原因不明の500として扱われ、`LedgerExceptionFilter`の汎用
フォールバックメッセージ (`"unexpected error"`) がそのままクライアントに返っていた
(本番投入前から存在していた既存バグ。iOSのLIFF `pageshow`リロード対策で保存済み
IDトークンを複数回再送する構成上、期限切れトークンでの再送は通常のフローとして
発生しうるため、ユーザー影響のある不具合として顕在化した)。

`auth.service.ts`に private な検証ラッパー (`verifyLineIdToken`/`exchangeSengokuSsoCode`/
`verifyAgencySso`) を追加し、各verifierの例外を捕捉して`UnauthorizedException`として
再送出するよう修正した。これにより検証失敗は常に401 (`{"message": "...", "error":
"Unauthorized", "statusCode": 401}`) として返るようになり、原因不明の500は発生しない。

### フロントエンド (`apps/user-wallet`) 側のLINEログイン (2026-07-18実装・実チャネル結合試験完了)

`apps/user-wallet/src/lib/liff.ts` が `@line/liff` を使ったLIFFログインフローを実装する。
`NEXT_PUBLIC_LINE_LIFF_ID` (Next.jsのビルド時公開環境変数) が未設定の場合は一切呼ばれず、
`login/page.tsx` は従来通り疑似ID (`mock.<uuid>`) を直接`/api/v1/auth/line/login`へ送る
モック実装のまま動作する (ローカル開発・CI・Playwright E2Eはこの経路のまま無改修で成功)。

設定済みの場合のフロー:
1. 「LINEでログイン」クリック時に `liff.init()` → 既にログイン状態が残っていても一度
   `liff.logout()` してから `liff.login()` でLINEのログイン画面へ遷移する (期限切れの
   IDトークンを誤って使い回さないため)。利用規約同意状態は `localStorage` に一時保存する。
2. LINE側の認証後、同じ`/login`URLへリダイレクトされて戻ってくる。
3. ページ読み込み時の `useEffect` で `liff.isLoggedIn()` を再確認し、trueなら
   `liff.getIDToken()` で実際のIDトークンを取得し、取得できた時点で即座に`localStorage`へ
   保存した上で `/api/v1/auth/line/login` へ送信する。

**実チャネルでの結合試験(2026-07-18)で発覚し対応した問題**:
- iOS上のLIFF SDKには、`pageshow`イベント発生時に無条件で`window.location.reload()`する
  挙動があり、API送信・画面遷移が完了する前にリロードが繰り返されるループが発生した。
  IDトークン取得後は`liff.init()`を再度呼ばずに保存済みのIDトークンで直接送信し直す方式で
  回避した。
- ログインAPI自体は成功するものの、直後の`/wallet`でのAPI呼び出しでセッションCookieが
  送信されず401→`/login`への差し戻しが発生していた。原因はVercel(フロントエンド)と
  Railway(API)が別ドメインのため`SameSite=None`で発行していたセッションCookieを、
  iOS Safari/WebKitのIntelligent Tracking Prevention(ITP)が制限していたためと判明した。
  `apps/user-wallet/next.config.mjs`の`rewrites()`で`/api/*`宛のリクエストを同一オリジンに
  見せかけてAPIへ転送する方式(Vercelのエッジがサーバー側で転送するため、ブラウザからは
  真の同一オリジンに見える)に変更し、Cookieを完全な第一者Cookieとして扱わせることで解決した。

実チャネル(LINE Developersで発行したLIFFアプリ、iPhone実機・Chrome/Safari双方)での
ログイン→ウォレット画面表示までの一連の動作を確認済み。

## 戦国パスポートSSO

`SengokuSsoService`:

- 256bit以上のランダム値からなるコード (`lookupId.secret` 形式)。
- 有効期限60秒・1回のみ利用可能・ハッシュ化して保存 (Redis, TTL 60秒)。
- コード自体に氏名・メール・電話番号・LINEユーザーID・OVE残高・戦国パスポートの
  セッション情報を一切含めない。
- 開発用に `POST /api/v1/auth/sso/sengoku/dev-issue` でモックコードを発行できる。

## 利用規約同意の永続化

`ove_accounts.terms_agreed_at` (DateTime?) / `terms_version` (String?) に、新規アカウント
作成時点の同意日時とバージョン (`apps/api/src/accounts/accounts.service.ts` の
`CURRENT_TERMS_VERSION`、現在 `"1.0"`) を記録する。

- `AccountsService.findOrCreateByIdentity()` は、**新規にアカウントを作成する場合のみ**
  `termsAccepted: true` を必須とし、指定がなければ400エラーで作成を拒否する
  (`termsAgreedAt`/`termsVersion` は作成時の1回のみ記録し、以後は更新しない)。
- 既存アカウントでの再ログイン (`accountIdentity` が既に存在する場合) は
  `termsAccepted` を要求しない — 同意は初回登録時のみでよい、という一般的なUXに合わせている。
- `POST /api/v1/auth/email/verify-otp` / `POST /api/v1/auth/line/login` /
  `POST /api/v1/auth/sso/sengoku/exchange` のリクエストボディにオプションの
  `termsAccepted: boolean` を追加し、`apps/user-wallet` のログイン画面
  (`/login`) から送信する。画面には `/terms` (OVE利用規約) へのリンク付き
  同意チェックボックスを表示し、未チェックのまま送信すると画面側でも拒否する。
- `AdminMigrationService` (既存ユーザー一括移行) や `AccountsService.findOrCreateByServiceLink`
  (外部サービスAPI経由の初回自動プロビジョニング) は対話的な同意画面を経由しないため、
  この必須化の対象外としている (前者は `termsAccepted: true` を明示的に渡して意図を残している)。

E2Eテスト (`apps/api/src/e2e/terms-consent.test.ts`) で、同意なしの新規作成が
400で拒否されアカウントが作成されないこと、同意ありで `terms_agreed_at`/`terms_version`
が記録されること、既存アカウントの再ログインでは同意不要であることを検証済み。

## 管理者認証

- `packages/database` の `admin_users` テーブル (`role`: SUPER_ADMIN / OVE_OPERATOR /
  INTEGRATION_ADMIN / EVENT_OPERATOR / AUDITOR / VIEWER)。
- パスワードは scrypt でハッシュ化。
- ログイン後のセッションはRedis (`admin-session:<sha256(token)>` キー) に保存し、
  12時間のTTLを設定。DBテーブルを追加せずRedisのみで管理する簡易実装 (MVP)。
- `RolesGuard` (`apps/api/src/common/roles.guard.ts`) で `@Roles(...)` デコレータにより
  エンドポイント単位の権限分離を実現。

## 管理画面MFA (TOTP二要素認証)

RFC 6238準拠のTOTP実装 (`packages/auth/src/totp.ts`) を自前で実装した (外部ライブラリ非依存、
Google Authenticator等の標準的な認証アプリと相互運用可能)。RFC 6238 Appendix Bの公式テスト
ベクタに対する単体テストで実装の正しさを検証済み。

- `admin_users.mfa_secret_encrypted` にTOTPシークレットをAES-256-GCMで可逆暗号化して保存する
  (署名検証と同じ理由: 検証のたびに平文シークレットを再取得する必要があるため一方向ハッシュは
  使えない)。`mfa_enabled` / `mfa_enrolled_at` で有効化状態を管理する。
- **設定フロー**: `POST /api/v1/admin/mfa/setup` (要ログイン) が新しいシークレットを生成して
  返す (この時点では `mfa_enabled` はfalseのまま)。認証アプリにシークレット/`otpauth://` URLを
  登録した後、`POST /api/v1/admin/mfa/enable` に確認コードを送ると検証の上で有効化される。
  管理画面の「セキュリティ設定」画面 (`/security`) から操作する。
- **ログインフロー**: `POST /api/v1/admin/login` はMFA未設定の管理者にはそのままセッションを
  発行するが、MFA設定済みの管理者にはセッションを発行せず `{ mfaRequired: true, mfaToken }`
  を返す (Cookieもセットしない)。`mfaToken` はRedisに5分間のみ保存される使い捨てトークンで、
  `POST /api/v1/admin/login/mfa` に `mfaToken` + 認証アプリの6桁コードを送ってはじめて
  セッションが発行される。
- **無効化**: `POST /api/v1/admin/mfa/disable` はパスワードと現在のTOTPコードの両方を要求する
  (どちらか一方が漏洩しただけでは無効化できないようにするため)。
- 有効化・無効化はいずれも監査ログ (`ADMIN_MFA_ENABLED`/`ADMIN_MFA_DISABLED`) に記録される。

E2Eテスト (`apps/api/src/e2e/admin-mfa.test.ts`) で、設定→誤ったコードでの有効化拒否→
正しいコードでの有効化→MFA必須ログイン→誤ったコードでの2段階目拒否→正しいコードでの
セッション発行→使い捨てトークンの再利用拒否→無効化、の一連の流れを検証済み。実ブラウザでも
QRコード用URL・シークレットキーの表示、コード誤り時のエラー表示 (日本語化済み)、
有効化後の実ログインまで確認済み。

## 未実装/簡略化した項目 (今後の課題)

- LINE本番連携: `LineIdTokenVerifier` を実装済みだが、実チャネルでの結合テストは未実施
  (上記「LINEログイン」節参照)。
- 戦国パスポート本番SSO交換: インターフェースとモックのみ。相手方のAPI仕様が未確定のため
  未着手 (`docs/project-status.md` 参照)。
