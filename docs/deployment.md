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

## 本番デプロイに向けた注意点

- ~~監査ログ (`audit_logs`) テーブルに対する、DBユーザー権限レベルでの `DELETE` 禁止設定~~
  → **対応済み**。DBトリガーでDELETE/UPDATEを常に拒否する (`docs/security.md`
  「監査ログのDBレベル不変性」参照)。
- ~~`@nestjs/throttler` のレート制限値の見直し~~ → **一部対応済み**。ログイン系
  エンドポイント (管理者ログイン・MFA・メールOTP検証) は総当たり対策として全体既定
  (60秒120回) より厳しい60秒10回に個別設定した (`docs/security.md`
  「レート制限値の見直し」参照)。外部サービスAPIについては下記「レート制限 (外部API)」を参照。
- `ENCRYPTION_KEY` のローテーション手順 → 下記「ENCRYPTION_KEYのローテーション」参照。
- CORS本番設定 → 下記「CORS本番設定」参照。
- ~~コンテナ化 (Dockerfile) は本リポジトリには未整備~~ → **対応済み**。3アプリそれぞれに
  本番用Dockerfileを用意した (下記「Dockerイメージ (本番)」参照)。`docker-compose.yml` は
  引き続きPostgreSQL/Redisのみを対象としている (ローカル開発用。アプリ本体は
  `pnpm dev:*` で起動する運用のため、意図的に含めていない)。

## ENCRYPTION_KEYのローテーション

`ENCRYPTION_KEY` はAES-256-GCMで以下の2種類のシークレットを暗号化して保存するために使う
(`packages/auth/src/encryption.ts`)。

- `admin_users.mfaSecretEncrypted` (管理者MFAのTOTPシークレット)
- `service_integrations.signingSecretEncrypted` (外部サービスAPIのHMAC署名シークレット)

**現状の実装は鍵バージョニングに対応していない** (暗号文に鍵のバージョン情報を含めていない、
単一の `ENCRYPTION_KEY` のみを保持する設計)。そのため `ENCRYPTION_KEY` の値を単純に
差し替えると、既存の暗号文がすべて復号不能になる (管理者は全員MFAが壊れ、外部サービスは
全て署名検証に失敗する)。ローテーションする際は、鍵を差し替える前に **旧鍵でいったん
全件復号し、新鍵で再暗号化してDBを更新する** 一括移行を無停止(またはメンテナンス時間内)で
行う必要がある。

1. 新しい `ENCRYPTION_KEY` の値を生成する (例: `openssl rand -base64 32`)。
2. アプリを旧鍵のまま起動した状態で、以下を1回実行するメンテナンススクリプトを用意する
   (このリポジトリにはまだ実装していない。実装する場合は
   `packages/auth` の `decryptSecret`/`encryptSecret` を再利用し、`admin_users` と
   `service_integrations` の対象カラムを1行ずつ 旧鍵で復号→新鍵で暗号化→更新 する):
   - `admin_users.mfaSecretEncrypted` が非NULLの行すべて
   - `service_integrations.signingSecretEncrypted` が非NULLの行すべて
3. 移行スクリプトの実行が完了してから (DB上のすべての暗号文が新鍵に対応してから)、
   環境変数 `ENCRYPTION_KEY` を新しい値に切り替えてアプリを再起動する。
4. 手順2と3の間にアプリが稼働し続けると、新規のMFA設定/外部サービス登録は旧鍵で
   暗号化されてしまうため、可能であれば手順2〜3の間は該当機能 (MFA設定・外部サービス
   新規登録) を一時的に停止するか、メンテナンスウィンドウ内で実施すること。
5. ローテーション後、旧鍵は安全に破棄する (シークレットマネージャの世代管理機能で
   一定期間保持してから削除する運用が望ましい)。

## CORS本番設定

`apps/api/src/main.ts` は `APP_URL`/`ADMIN_URL` に設定された値のみをCORS許可オリジンとして
登録する (`app.enableCors({ origin: allowedOrigins, credentials: true })`)。値が未設定の
場合は許可オリジンが0件になり、ブラウザからのクロスオリジンリクエストは (Cookie送信を
伴うものも含めて) すべて拒否される (フェイルクローズ)。

本番環境では、`APP_URL`/`ADMIN_URL` をそれぞれ本番ドメイン (例:
`https://wallet.example.com` / `https://admin-wallet.example.com`) に設定するだけで、
コード変更なしに正しいCORS設定になる。外部サービスAPI (`/api/v1/service/accounts/*` 等)
はサーバー間通信でありブラウザのCORS制約を受けないため、この設定の対象外で問題ない。

## レート制限 (外部API)

外部サービスAPI (`/api/v1/service/accounts/*`、`/rewards/grant` 等) は現状、ログイン系
エンドポイントと同じグローバル既定 (60秒120リクエスト) が適用され、`@nestjs/throttler`の
既定実装によりIPアドレス単位でカウントされる。連携先が増え、1つのIPから継続的に
120回/分を超える正当なトラフィックが発生する場合は、`X-OVE-Api-Key` (連携先ID) を
キーにした専用のレート制限バケットへの変更を検討すること (現状は未実装)。

## Dockerイメージ (本番)

`apps/api`・`apps/user-wallet`・`apps/admin-wallet` それぞれに本番用マルチステージ
`Dockerfile` を用意した。pnpmワークスペース構成のため、**ビルドコンテキストは
リポジトリルート** (各Dockerfileが依存パッケージのpackage.json/ソースを参照するため)。

```bash
# apps/api (NestJS)
docker build -f apps/api/Dockerfile -t ove-wallet-api .
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/ove_wallet_dev \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e NODE_ENV=production -e AUTH_MODE=production \
  -e APP_URL=https://wallet.example.com -e ADMIN_URL=https://admin-wallet.example.com \
  -e SESSION_SECRET=... -e ENCRYPTION_KEY=... \
  ove-wallet-api

# apps/user-wallet / apps/admin-wallet (Next.js, standalone出力)
# NEXT_PUBLIC_API_URL はNext.jsの仕様上ビルド時に埋め込まれるため --build-arg で渡す
docker build -f apps/user-wallet/Dockerfile -t ove-wallet-user \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
docker run --rm -p 3000:3000 ove-wallet-user

docker build -f apps/admin-wallet/Dockerfile -t ove-wallet-admin \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
docker run --rm -p 3100:3100 ove-wallet-admin
```

Next.jsの2アプリは `next.config.mjs` の `output: "standalone"` を使い、実行に必要な
`node_modules` のみをトレースした自己完結フォルダ (`.next/standalone`) をベースにしている
(Next.js公式のDocker推奨構成)。`apps/api` はワークスペース内の依存パッケージ
(`database`/`auth`/`ledger`/`shared-types`/`config`) をビルドステージ内でまとめてビルドしてから
`node_modules` ごと実行イメージにコピーする素朴な構成であり、`pnpm deploy` やturborepoの
prune機能によるさらなる最小化は今回のスコープでは行っていない (将来の改善余地)。

**検証状況**: このリポジトリの開発コンテナにはDockerデーモンが無く、`docker build`/
`docker run` そのものは未実行。ただし各Dockerfileの各RUNステップに対応する処理
(`pnpm install`、`pnpm -r build`、`next build` with `output: "standalone"`) は
このドキュメント作成時にコンテナ外で個別に実行し、いずれも成功することを確認済み。
実際にDockerが使える環境で `docker build` によるエンドツーエンドの検証を行うこと。

## Swagger

`apps/api` 起動後、`http://localhost:4000/api/docs` でOpenAPI定義を確認できる。
