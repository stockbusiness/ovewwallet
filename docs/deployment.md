# デプロイ

## ローカル開発

```bash
cp .env.example .env   # DATABASE_URL, REDIS_URL 等を編集
docker compose up -d   # PostgreSQL + Redis (Dockerが使えない環境ではネイティブ起動でも可)

pnpm install
pnpm db:migrate:dev     # (無ければ) packages/database で prisma migrate dev
pnpm db:seed            # 初期管理者・サービス連携・付与ルールを投入

pnpm dev:api            # apps/api を http://localhost:4000 で起動
pnpm dev:user           # apps/user-wallet を http://localhost:3000 で起動
pnpm dev:admin          # apps/admin-wallet を http://localhost:3100 で起動
```

初期管理者のメールアドレスは `admin@ovewallet.local`。パスワードは `seed` 実行時に
コンソールへ出力される (`SEED_ADMIN_PASSWORD` 環境変数で固定値を指定することも可能)。
**必ず初回ログイン後にパスワードを変更すること。**

## 本番デプロイに向けた注意点 (未整備・今後の課題)

- 監査ログ (`audit_logs`) テーブルに対する、DBユーザー権限レベルでの `DELETE` 禁止設定
  (`REVOKE DELETE ON audit_logs FROM <app_role>;` 等) をインフラ側の手順として追加すること。
- `ENCRYPTION_KEY` (署名シークレット暗号化用) は本番では十分な長さのランダム値を
  シークレットマネージャ等で管理し、ローテーション手順を用意すること。
- CORS許可オリジン (`APP_URL`, `ADMIN_URL`) を本番ドメインに合わせて設定すること。
- `@nestjs/throttler` のレート制限値 (現状: 60秒120リクエスト、グローバル一律) は
  エンドポイントごとの特性に応じて見直すこと。
- コンテナ化 (Dockerfile) は本リポジトリには未整備。`docker-compose.yml` はPostgreSQL/Redis
  のみを対象としている。

## Swagger

`apps/api` 起動後、`http://localhost:4000/api/docs` でOpenAPI定義を確認できる。
