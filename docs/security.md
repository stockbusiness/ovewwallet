# セキュリティ (指示書16章)

## 実装済み

- HTTPS前提 (Cookie: `Secure`, `HttpOnly`, `SameSite=Lax`)。
- 入力値検証: Zodスキーマ (`packages/shared-types`, 各コントローラ内) + `ZodValidationPipe`。
- SQLインジェクション対策: Prismaのパラメータ化クエリのみ使用 (生SQLは
  `$queryRaw`/`$executeRaw` のタグ付きテンプレートのみで、文字列結合による生成はしていない)。
- XSS対策: Next.jsのデフォルトエスケープに依存 (`dangerouslySetInnerHTML` 不使用)。
- CSRF対策: `SameSite=Lax` Cookie + CORSオリジン制限 (`APP_URL`/`ADMIN_URL` のみ許可)。
- ブルートフォース対策: メールOTPの試行回数上限(5回、メールアドレス単位)・再送間隔(60秒)。
  `@nestjs/throttler` によるグローバルレート制限 (60秒あたり120リクエスト、MVP値) に加え、
  ログイン系エンドポイント (管理者ログイン `POST /admin/login`・管理者MFA
  `POST /admin/login/mfa`・メールOTP検証 `POST /auth/email/verify-otp`) はIPアドレス単位で
  60秒あたり10リクエストに個別に制限し、総当たりの試行速度をさらに絞っている
  (下記「レート制限値の見直し」参照)。
- APIキー・署名シークレットの平文非保存 (`docs/database.md` 参照)。
- 監査ログ (`audit_logs`): アプリケーション層にdelete用のAPI/UIを一切実装していない。
  さらにDBレベルでも改ざん・削除を防止している (下記「監査ログのDBレベル不変性」参照)。
- 管理権限分離: `AdminRole` によるロールベースアクセス制御 (`RolesGuard`)。
- 高額操作の承認: `HIGH_VALUE_THRESHOLD` 以上の個別付与・個別減算は二段階承認
  (申請者と承認者が別人であることを強制) を経なければ実行されない
  (`docs/admin-operations.md` の「二段階承認」参照)。
- request_id付与: 全リクエストに `x-request-id` を採番しレスポンスヘッダへ付与
  (`apps/api/src/common/request-id.middleware.ts`)。エラーレスポンスにも含める。
- 残高整合性検査: `GET /api/v1/admin/reconciliation` (`docs/ledger-rules.md`)。
- 管理画面MFA: RFC 6238準拠のTOTP二要素認証 (`docs/authentication.md` の「管理画面MFA」参照)。
  管理者ごとに任意で有効化でき、有効化するとログイン時にパスワードに加えて認証アプリの
  コードが必須になる。
- ログに出力しない情報: ワンタイムコード・IDトークン本文・アクセストークン・APIシークレット・
  Cookie・セッション原文・秘密鍵・パスワードは、いずれのログ出力コードにも含めていない
  (Nestの標準ロガーはHTTPボディを自動ログしない)。

## 全セッション無効化

`POST /api/v1/admin/accounts/:accountId/revoke-sessions` (`SUPER_ADMIN`/`OVE_OPERATOR`のみ) で、
不正利用が疑われるアカウントの有効なセッションを端末を問わず一括で失効させられる。
`user_sessions.revoked_at`/`revoke_reason: "ADMIN_FORCED_LOGOUT"` を設定するため、無効化と
同時に (TTL経過を待たず) 該当セッションでの以後のリクエストはすべて401になる。アカウント
統合時の統合元セッション無効化 (`packages/ledger/src/merge.ts`) と同じ仕組みを、任意の
アカウントに対して単独で呼び出せるようにしたもの。アカウント詳細画面
(`/accounts/[accountId]`) にアクティブセッション数の表示とボタンを追加した。実行内容は
監査ログ (`ACCOUNT_SESSIONS_REVOKED`) に記録される。

E2Eテスト (`apps/api/src/e2e/revoke-sessions.test.ts`) で、複数端末のセッションが同時に
失効すること、失効後は即座に401になること (TTL待ちでないこと)、セッションが既にない
状態での再実行が0件で冪等に成功すること、権限のないロールでの403拒否を検証済み。
実ブラウザでも、無効化前後でセッション数表示が更新されること、実際にユーザー側の
セッションが使えなくなることを確認済み。

## API利用者ごとのアクセス制御分離 (開発ガイドライン12.1章)

残高照会・取引履歴・取引詳細を、本人向け・外部サービス向けで完全に分離した
(旧 `GET /api/v1/wallets/{oveAccountId}/...` は `oveAccountId` さえ知っていれば
誰でも参照できてしまう実装だったため廃止):

- 本人向け: `GET /api/v1/me/wallet` / `/me/transactions` / `/me/transactions/{id}`
  (OVE独自セッション認証、URLでOVEアカウントIDを受け取らずセッションから解決)。
- 外部サービス向け: `GET /api/v1/service/accounts/{externalUserId}/balance`
  (HMAC認証、認証済みの連携先自身の `external_user_id` のみ照会可能。他サービスに
  紐づく `external_user_id` を指定すると404になる)。
- 管理者向け: 既存の `GET /api/v1/admin/wallets/{walletId}` (管理者セッション認証)。

E2Eテスト (`apps/api/src/e2e/me-and-service-accounts.test.ts`) で、旧エンドポイントが
404になること、本人セッションで他人の残高・取引が取得できないこと、外部サービスが
他サービス利用者の残高を照会できないことを検証済み。実ブラウザでも本人向けAPIへの
移行後の動作を確認済み。

## モック認証の本番起動ガード (開発ガイドライン12.2章)

`apps/api/src/common/assert-auth-mode.ts` が起動時に検証し、`NODE_ENV=production` かつ
`AUTH_MODE` が `production` 以外 (未設定を含む) の場合はアプリ起動自体を失敗させる。
LINEログイン・戦国パスポートSSOの本番実装が接続されるまでは、本番環境を起動できない。
単体テスト (`apps/api/src/common/assert-auth-mode.test.ts`) で検証済み。

## 監査ログのDBレベル不変性

`audit_logs` へのDELETE/UPDATEを、アプリケーション層の実装漏れだけでなく、Postgresの
BEFOREトリガー (`prevent_audit_logs_mutation()`、マイグレーション
`add_audit_logs_immutability_trigger`) で常に例外を送出して拒否している。

このアプリはPostgresの特権ユーザー (`postgres`) で接続しているため、
`REVOKE DELETE/UPDATE` による権限剥奪はスーパーユーザーには効果がなく無意味である。
そのため、接続ロールに関わらず (アプリのバグ・誤ったDB直接操作を含めて) 確実に
拒否できるトリガー方式を採用した。トリガー自体を無効化すれば理論上は迂回できるが、
それは通常の運用・アプリ操作の範囲外であり、DBA権限を持つ攻撃者を完全に防ぐ設計は
本対応の範囲外とする (指示書が求める「DB権限レベルでのDELETE禁止」を、実際に効果のある
形で満たすことを目的とした)。

単体テスト (`apps/api/src/e2e/audit-log-immutability.test.ts`) で、DELETE/UPDATEが
DBレベルで例外になりトランザクションごとロールバックされること、通常のINSERT/SELECTは
影響を受けないことを検証済み。

## レート制限値の見直し

管理者ログイン・管理者MFA・メールOTP検証は、パスワード/6桁コードの総当たり攻撃の対象に
なりうるため、`@nestjs/throttler` の `@Throttle({ default: { limit: 10, ttl: 60_000 } })` で
IPアドレス単位60秒10回に個別制限した (全体既定の60秒120回より厳しい)。
メールOTP検証はメールアドレス単位の5回試行上限 (`packages/auth/src/email-otp.ts`) に
加えたIPベースの多層防御であり、片方が回避されてももう片方が効く設計にした。

この作業中に、期限切れ・未発行のOTPコードで検証しようとした場合に `OtpVerificationError`
が未捕捉のまま500エラーになる既存の実装ミスを発見した。誤ったコードを入力した場合は
正しく401になっていたが、コード自体が存在しない/期限切れの場合だけ500になっていた
(内部エラーの詳細が意図せず露出しうる状態)。`AuthService.verifyEmailOtpAndLogin` で
`OtpVerificationError` を捕捉し、誤ったコードの場合と同じ401に統一する形で修正した。

単体テスト (`apps/api/src/e2e/rate-limit.test.ts`) で、管理者ログイン・メールOTP検証の
両方が11回目までに429になることを検証済み。管理者MFAコード自体は6桁 (100万通り) かつ
30秒ごとに失効するため、レート制限を課さなくても現実的な時間での総当たりは困難だが、
念のため同じ制限を適用した。

外部サービスAPIのレート制限については `docs/deployment.md` の「レート制限 (外部API)」を
参照 (連携先ごとの専用バケットは未実装)。

## 未実装・今後の課題

- 個人情報のURL掲載禁止: SSOコード・OTPには個人情報を含めない設計を徹底しているが、
  他のURLパラメータ全体の監査は未実施。

## 実装中に修正したセキュリティ関連のバグ

1. **HMAC署名シークレットの一方向ハッシュ化** — 検証に平文が必要なため、
   実装当初のミスを可逆暗号化 (AES-256-GCM) に修正 (`docs/database.md` 参照)。
2. **セッショントークンのハッシュ方式** — scrypt (ソルト付き) では検索キーとして
   機能しないバグを、SHA-256の決定的ハッシュに修正。
