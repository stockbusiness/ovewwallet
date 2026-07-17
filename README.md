# OVE Wallet Platform

戦国パスポート・AIアート教室・戦国ガチャ・EC・NFTマーケット・将来のメタバースなどから
共通利用される、独立したOVE残高管理基盤 (オフチェーン型ポイント・取引台帳)。

現在のOVEはブロックチェーン上の暗号資産ではなく、サービス内で管理するポイントです。
将来のオンチェーン移行に備え、ユーザー識別・取引履歴・残高根拠・外部サービス連携・
移行記録を保持する設計にしています。

詳細な設計・実装状況は `docs/` 配下を参照してください。**現時点の実装状況の全体サマリ
(完了機能一覧・LINE連携の保留状況・代理店システム等の外部連携に向けた方針) は
`docs/project-status.md` を参照してください。** 初期の実装計画は `docs/implementation-plan.md`、
既知の未実装項目は各 `docs/*.md` の「今後の課題」セクションにまとめています。

## 技術構成

| カテゴリ | 技術 |
|---|---|
| ユーザー画面 | Next.js 14 (App Router) / React / Tailwind CSS |
| 管理画面 | Next.js 14 (App Router) / React / Tailwind CSS |
| API | NestJS 10 / REST / OpenAPI (Swagger) |
| データベース | PostgreSQL / Prisma ORM |
| 補助 | Redis (レート制限・OTP・SSOコード。未設定時はインメモリへフォールバック) |
| バリデーション | Zod (`packages/shared-types` で共通化) |
| テスト | Vitest (`packages/*`) / Jest+ts-jest+Supertest (`apps/api`) / Playwright (`tests/e2e`, ブラウザE2E) |

## ディレクトリ構成

```
apps/
  user-wallet/   ユーザー向けNext.jsアプリ (port 3000)
  admin-wallet/  管理者向けNext.jsアプリ (port 3100)
  api/           NestJS API (port 4000)
packages/
  database/      Prisma schema・DBクライアント
  shared-types/  共通enum・zod DTO
  shared-ui/     (将来の共通UI抽出用、現状未使用)
  auth/          認証・暗号ユーティリティ
  ledger/        台帳コアロジック
  config/        環境変数検証
tests/
  e2e/           Playwright E2E (ブラウザ操作の自動テスト。`pnpm test:e2e`、詳細は`tests/e2e/README.md`)
docs/            設計ドキュメント一式
```

## ローカル起動方法

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL + Redis
pnpm install
pnpm --filter @ove/database migrate:dev
pnpm --filter @ove/database seed

pnpm dev:api      # http://localhost:4000  (Swagger: /api/docs)
pnpm dev:user     # http://localhost:3000
pnpm dev:admin    # http://localhost:3100
```

初期管理者は `admin@ovewallet.local`。パスワードは `seed` 実行時にコンソール出力される。

## 環境変数

`.env.example` を参照。最低限 `DATABASE_URL`, `SESSION_SECRET`, `COOKIE_DOMAIN`,
`APP_URL`/`API_URL`/`ADMIN_URL` の設定が必要。実際のシークレットはコミットしないこと。

## DBマイグレーション

```bash
pnpm --filter @ove/database migrate:dev   # ローカル開発用
pnpm --filter @ove/database migrate       # prisma migrate deploy (本番/CI)
```

## テスト方法

```bash
pnpm test                         # packages/*・apps/api を一括実行 (tests/e2eは含まない)
pnpm --filter @ove/auth test      # 認証ユーティリティの単体テスト
pnpm --filter @ove/ledger test    # 台帳コアの単体・統合テスト (実PostgreSQL接続が必要)
pnpm --filter @ove/api test       # APIのE2Eテスト (実PostgreSQL接続が必要)
pnpm test:e2e                     # ブラウザE2E (Playwright、実DB+3アプリ起動が必要。tests/e2e/README.md参照)
pnpm test:load                    # 簡易負荷・レート制限限界値テスト (apps/apiの起動が必要。docs/test-plan.md参照)
```

事前に `.env.test` (DATABASE_URL等をテスト用DBに向けたもの) を用意し、
テスト用DBへマイグレーションを適用しておくこと
(`pnpm --filter @ove/database migrate:test` 相当の手順)。

## Swagger URL

`http://localhost:4000/api/docs`

## ドキュメント一覧

- `docs/architecture.md` — 全体構成・技術選定理由
- `docs/database.md` — データモデル詳細
- `docs/authentication.md` — 認証設計
- `docs/ledger-rules.md` — 台帳ルール・整合性チェック
- `docs/external-api.md` — 外部サービスAPI仕様
- `docs/integration-outbox.md` — Transactional Outbox・Feature Flag基盤
- `docs/agency-integration.md` — 戦国経済圏代理店システム(sengoku-ai.com)外部連携
  (同期受信API・SSOログイン、外部連携API仕様書v3.6.71対応)
- `docs/agency-referral.md` — 代理店紹介トークン受け入れ・登録特典 (Phase 1: `/invite/{token}`
  受付・LINEログイン時の紐付け・特典保留まで)
- `docs/admin-operations.md` — 管理画面操作
- `docs/ui-design.md` — 戦国ウォレット UIデザインシステム (デザイントークン・共通コンポーネント)
- `docs/migration.md` — 既存ユーザー移行 (事前承認制・職務分離・Shift_JIS対応まで実装済み)
- `docs/security.md` — セキュリティ対策と既知の課題
- `docs/test-plan.md` — テスト計画と実施結果
- `docs/deployment.md` — デプロイ手順
- `docs/monitoring.md` — 監視・アラート (エラートラッキング・ヘルスチェック・ログ収集)
- `docs/backup.md` — DBバックアップ・リストア手順
- `docs/feature-list.md` — 機能一覧
- `docs/implementation-log.md` — 時系列の実装記録
- `docs/implementation-plan.md` — 実装計画・フェーズ進行状況
- `docs/development-guardrails.md` — 代理店システム等の外部連携に向けた開発基準
  (正式な管理元の分離・ID設計・紹介連携・セキュリティ必須項目・実装順序)
- `AGENTS.md` — 実装・変更時の禁止事項
