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

## 管理者認証

- `packages/database` の `admin_users` テーブル (`role`: SUPER_ADMIN / OVE_OPERATOR /
  INTEGRATION_ADMIN / EVENT_OPERATOR / AUDITOR / VIEWER)。
- パスワードは scrypt でハッシュ化。
- ログイン後のセッションはRedis (`admin-session:<sha256(token)>` キー) に保存し、
  12時間のTTLを設定。DBテーブルを追加せずRedisのみで管理する簡易実装 (MVP)。
- `RolesGuard` (`apps/api/src/common/roles.guard.ts`) で `@Roles(...)` デコレータにより
  エンドポイント単位の権限分離を実現。

## 未実装/簡略化した項目 (今後の課題)

- OVE利用規約同意の永続化 (現状はUIフローとしてのみ想定、DBへの同意記録カラムは未追加)。
- 管理画面MFA (拡張ポイントとしてのみ確保、実装なし)。
- LINE本番連携・戦国パスポート本番SSO交換 (インターフェースとモックのみ)。
