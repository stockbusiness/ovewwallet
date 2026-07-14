# データベース設計

PostgreSQL + Prisma。スキーマ定義は `packages/database/prisma/schema.prisma`。

## 命名規則

- 内部主キー (`id`) は ULID (`packages/database/src/id.ts` の `generateId()`)。
  LINEユーザーID・戦国パスポート会員ID・メールアドレス等は主キーに使わない。
- 表示用コード (`account_code`, `wallet_code`, `transaction_code`) は
  `code_counters` テーブルを `UPDATE ... RETURNING` で原子的にインクリメントして採番する
  (`packages/database/src/codes.ts`)。例: `OVE-ACC-00000001`。

## 指示書7章で指定された必須テーブル (13)

| テーブル | 役割 |
|---|---|
| `ove_accounts` | ユーザーの正式アカウント。`merged_into_account_id` で統合を表現 |
| `account_identities` | LINE/EMAIL/PHONE/PASSKEY/GOOGLE/APPLE/BLOCKCHAIN_WALLET の認証情報。`(provider, provider_subject)` に一意制約 |
| `service_integrations` | 外部サービスAPIの認証情報。APIキーはハッシュ、署名シークレットは暗号化して保存 (下記「秘密情報の扱い」参照) |
| `account_links` | OVEアカウントと外部サービスの `external_user_id` の紐付け。`(service_integration_id, external_user_id)` に一意制約 |
| `wallets` | 1アカウント1ウォレット。`available/pending/held/recovery_balance`, `lifetime_credited/debited` |
| `ove_transactions` | 台帳本体。`idempotency_key` に一意制約。`related_transaction_id` で取消の対応関係を保持 |
| `reward_rules` | 付与ルール (上限・期間・承認種別) |
| `wallet_holds` | 保留の記録。ove_transactions 側の HOLD/RELEASE と対になる |
| `user_sessions` | OVE独自セッション。`session_token_hash` はSHA-256の決定的ハッシュ (検索キーとして使うため) |
| `audit_logs` | 監査ログ。アプリケーション層・DB権限の両方で削除不可とすることを想定 (`docs/security.md`) |
| `blockchain_migrations` | 将来のオンチェーン移行用データ構造 (MVPでは画面・処理なし) |

## 補足テーブル (指示書7章に明記はないが、要件を満たすために追加)

| テーブル | 追加理由 |
|---|---|
| `admin_users` | 管理者ログイン・権限分離 (指示書13章) に必須 |
| `code_counters` | 表示用コード採番の原子性を保証するため |
| `approval_requests` | 二段階承認 (指示書13章) の最小構造。フェーズ6で本実装予定 |
| `bulk_grant_batches` | CSV一括付与 (指示書14章) の実行結果集計を保存 |
| `migration_batches` | 既存ユーザー移行 (指示書15章) のバッチ情報を保存 |

## 秘密情報の扱い (重要)

- `service_integrations.api_key_hash`: scrypt (ソルト付き) の一方向ハッシュ。API認証時は
  「登録済み連携を全件取得し `verifySecret` で照合」する (連携数が少数のため許容)。
- `service_integrations.signing_secret_encrypted`: **HMAC署名の検証にはサーバー側で平文を
  再取得する必要がある**ため、一方向ハッシュではなく `ENCRYPTION_KEY` によるAES-256-GCM
  可逆暗号化で保存する (`packages/auth/src/encryption.ts`)。実装当初はここを誤って
  一方向ハッシュにしてしまい、HMAC検証が原理的に不可能になっていたバグを実装中に発見し修正した。
- `user_sessions.session_token_hash`: SHA-256 (`packages/auth/src/crypto.ts` の `sha256Hex`)。
  セッショントークンは256bit乱数で十分なエントロピーがあるため、パスワードのような
  低速ハッシュ (scrypt) は不要かつ検索キーとして使えない (scryptはソルトが毎回変わり
  同じ入力でも異なる出力になるため、一致検索に使えないという実装バグを事前に発見・修正した)。

## 主要な enum

`AccountStatus`, `IdentityType`, `ServiceCode`, `WalletStatus`, `TransactionDirection`,
`TransactionStatus`, `TransactionType`, `CreatedByType`, `ApprovalType`, `RewardRuleStatus`,
`WalletHoldStatus`, `AdminRole` など。詳細はPrisma schemaを参照。

## マイグレーション

```
pnpm --filter @ove/database migrate:dev   # 開発用DBへ適用 (ローカル)
pnpm --filter @ove/database migrate       # prisma migrate deploy (本番/CI)
pnpm --filter @ove/database seed          # 初期管理者・サービス連携・付与ルールを投入
```
