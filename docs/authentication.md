# 認証設計 (指示書10章)

## OVE独自セッション

- `packages/auth/src/session.ts` の `issueSession()` がセッショントークン (256bit乱数) を発行。
- Cookie名: `ove_session` (ユーザー) / `ove_admin_session` (管理者)。
- Cookie属性: `HttpOnly`, `Secure`, `SameSite=Lax`。認証トークンをLocalStorageへは保存しない。
- DBには `sessionTokenHash` (SHA-256の決定的ハッシュ) のみ保存し、平文トークンは保存しない。

## メールワンタイムコード

`packages/auth/src/email-otp.ts` の `EmailOtpService`:

- 6桁 / 有効期限10分 / 入力上限5回 / 再送間隔60秒 / 最新コードのみ有効。
- コードは scrypt でハッシュ化して保存 (平文保存禁止)。
- 保存先は Redis (`REDIS_URL` 未設定時はインメモリstoreへフォールバック。
  `packages/auth/src/kv-store.ts`)。

## LINEログイン

`packages/auth/src/sso.ts` の `LineAuthVerifier` インターフェースと
`MockLineAuthVerifier` (開発用モック、`mock.<lineUserId>` 形式のIDトークンを検証)。
本番実装はLINE Platform APIでIDトークンを検証する実装に差し替える (インターフェースは
確定済みなので実装の追加のみで対応可能)。LINEから受け取ったプロフィールをそのまま
信用しない方針を維持している。

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

- LINE本番連携・戦国パスポート本番SSO交換 (インターフェースとモックのみ)。
