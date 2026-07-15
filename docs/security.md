# セキュリティ (指示書16章)

## 実装済み

- HTTPS前提 (Cookie: `Secure`, `HttpOnly`, `SameSite=Lax`)。
- 入力値検証: Zodスキーマ (`packages/shared-types`, 各コントローラ内) + `ZodValidationPipe`。
- SQLインジェクション対策: Prismaのパラメータ化クエリのみ使用 (生SQLは
  `$queryRaw`/`$executeRaw` のタグ付きテンプレートのみで、文字列結合による生成はしていない)。
- XSS対策: Next.jsのデフォルトエスケープに依存 (`dangerouslySetInnerHTML` 不使用)。
- CSRF対策: `SameSite=Lax` Cookie + CORSオリジン制限 (`APP_URL`/`ADMIN_URL` のみ許可)。
- ブルートフォース対策: メールOTPの試行回数上限(5回)・再送間隔(60秒)。
  `@nestjs/throttler` によるグローバルレート制限 (60秒あたり120リクエスト、MVP値)。
- APIキー・署名シークレットの平文非保存 (`docs/database.md` 参照)。
- 監査ログ (`audit_logs`): アプリケーション層にdelete用のAPI/UIを一切実装していない。
  **DB権限レベルでのDELETE禁止 (REVOKE) は本番デプロイ時の運用手順として別途設定が必要**
  (このリポジトリのマイグレーションには含めていない)。
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

## 未実装・今後の課題

- 残高照会・取引履歴APIのアクセス制御強化 (`docs/external-api.md` 参照)。
- 個人情報のURL掲載禁止: SSOコード・OTPには個人情報を含めない設計を徹底しているが、
  他のURLパラメータ全体の監査は未実施。

## 実装中に修正したセキュリティ関連のバグ

1. **HMAC署名シークレットの一方向ハッシュ化** — 検証に平文が必要なため、
   実装当初のミスを可逆暗号化 (AES-256-GCM) に修正 (`docs/database.md` 参照)。
2. **セッショントークンのハッシュ方式** — scrypt (ソルト付き) では検索キーとして
   機能しないバグを、SHA-256の決定的ハッシュに修正。
