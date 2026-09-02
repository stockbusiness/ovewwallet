# デプロイ

> **本番環境の立ち上げは `docs/runbooks/production-launch.md` を参照してください。**
> 検証用デプロイとは別のRailwayプロジェクトを使います (検証データが本番の会計数値に
> 混ざるのを避けるため)。デプロイワークフローの `target` 入力で切り替えます。


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
- ~~`ENCRYPTION_KEY` の再暗号化スクリプトが無い~~ → **対応済み**。
  `packages/database/src/rotate-encryption-key.ts` を実装した (下記
  「ENCRYPTION_KEYのローテーション」参照)。
- CORS本番設定 → 下記「CORS本番設定」参照。
- ~~コンテナ化 (Dockerfile) は本リポジトリには未整備~~ → **対応済み**。3アプリそれぞれに
  本番用Dockerfileを用意した (下記「Dockerイメージ (本番)」参照)。`docker-compose.yml` は
  引き続きPostgreSQL/Redisのみを対象としている (ローカル開発用。アプリ本体は
  `pnpm dev:*` で起動する運用のため、意図的に含めていない)。

## ENCRYPTION_KEYのローテーション

`ENCRYPTION_KEY` はAES-256-GCMで以下の3種類のシークレットを暗号化して保存するために使う
(`packages/auth/src/encryption.ts`)。

- `admin_users.mfaSecretEncrypted` (管理者MFAのTOTPシークレット、nullable)
- `service_integrations.signingSecretEncrypted` (外部サービスAPIのHMAC署名シークレット)
- `wallet_referrals.referralTokenEncrypted` (代理店紹介トークン。Phase 2の外部送信用、
  `docs/agency-referral.md` 参照)

**現状の実装は鍵バージョニングに対応していない** (暗号文に鍵のバージョン情報を含めていない、
単一の `ENCRYPTION_KEY` のみを保持する設計)。そのため `ENCRYPTION_KEY` の値を単純に
差し替えると、既存の暗号文がすべて復号不能になる (管理者は全員MFAが壊れ、外部サービスは
全て署名検証に失敗し、紹介トークンも復号できなくなる)。ローテーションする際は、鍵を
差し替える前に **旧鍵でいったん全件復号し、新鍵で再暗号化してDBを更新する** 一括移行を
無停止(またはメンテナンス時間内)で行う必要がある。

1. 新しい `ENCRYPTION_KEY` の値を生成する (例: `openssl rand -base64 32`)。
2. アプリを旧鍵のまま起動した状態で、以下を1回実行する
   (`packages/database/src/rotate-encryption-key.ts`。1件でも復号に失敗した場合は
   DBを一切更新せず中断する安全設計。ローカルDBに対して実際に実行し、新鍵での復号・
   旧鍵での復号拒否・失敗時の未更新を確認済み):
   ```
   OLD_ENCRYPTION_KEY=<旧鍵> NEW_ENCRYPTION_KEY=<新鍵> \
     pnpm --filter @ove/database rotate-encryption-key
   ```
3. 移行スクリプトの実行が完了してから (DB上のすべての暗号文が新鍵に対応してから)、
   環境変数 `ENCRYPTION_KEY` を新しい値に切り替えてアプリを再起動する。
4. 手順2と3の間にアプリが稼働し続けると、新規のMFA設定/外部サービス登録は旧鍵で
   暗号化されてしまうため、手順2〜3の間は `MAINTENANCE_MODE=readonly` で更新を止める
   (下記「メンテナンスモード」参照)。
5. ローテーション後、旧鍵は安全に破棄する (シークレットマネージャの世代管理機能で
   一定期間保持してから削除する運用が望ましい)。

## メンテナンスモード

計画メンテナンス中にリクエストを止める仕組み
(`apps/api/src/common/maintenance-mode.middleware.ts`)。導入前は手順書に「一時的に
停止する」と書かれているだけで、**停止する手段が実装されていなかった**。

環境変数 `MAINTENANCE_MODE` を設定して再デプロイする。

| 値 | 挙動 | 使う場面 |
|---|---|---|
| (未設定) | 通常動作 | 平常時 |
| `readonly` | 更新系 (POST/PUT/PATCH/DELETE) を503。閲覧は通す | 列の追加など後方互換のあるマイグレーション、暗号鍵のローテーション |
| `full` | ヘルスチェック以外すべて503 | 列の削除・型変更など、読み取りも壊れうる変更 |

- **綴りを間違えた値・空文字はすべて「通常動作」**として扱う。間違えて全リクエストを
  止めるより、メンテナンスに入り損ねる方が安全なため (入り損ねは起動直後の動作確認で
  気づけるが、全断は気づくのが遅れる)。設定したら必ず実際に503が返ることを確認すること。
- **`/health` はどのモードでも通す**。ここを止めるとオーケストレータ (Railway等) が
  インスタンスを不健全と判定してコンテナを再起動し続け、メンテナンスのつもりが本物の
  障害になる。
- **定期実行ジョブも停止する** (`SchedulerService`)。失効・保持期間削除・Outbox送信・
  失効予告はいずれも書き込みで、裏で走り続けると更新を止めた意味が無い。見送った分は
  メンテナンス明けの次回スケジュールで拾われる。
- **管理画面も同じ扱い**にしている。素通しにすると、マイグレーション中のDBに対して
  管理者が書き込めてしまう。管理者だけ通したい場合は `off` に戻す方が状態が明確。
- 状態をDBに持たない。DBが落ちていても・マイグレーションで壊れていても確実に効くよう、
  メンテナンスの入口がメンテナンス対象に依存しないようにしている。

| 補助的な環境変数 | 既定 | 説明 |
|---|---|---|
| `MAINTENANCE_RETRY_AFTER_SECONDS` | `300` | 503に付ける`Retry-After`ヘッダの秒数 |
| `MAINTENANCE_MESSAGE` | 「ただいまメンテナンス中です。時間をおいて再度お試しください。」 | 画面に表示される文言。復帰予定時刻を入れる用途を想定 |

応答は `{ statusCode: 503, error: "Service Unavailable", message: ..., maintenance: true }`。
フロントエンドの`apiFetch`は`message`をそのまま画面に出すため、`MAINTENANCE_MESSAGE`に
書いた内容が利用者に表示される。

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

`apps/api` のコンテナは `apps/api/docker-entrypoint.sh` を起点として起動し、毎回
`prisma migrate deploy` (保留中のマイグレーション適用、冪等) を実行してからAPIを起動する。
`RUN_SEED_ON_BOOT=true` を設定すると、起動時に `packages/database/src/seed.ts`
(初期SUPER_ADMIN・付与ルール・外部サービス連携の初期レコード投入、すべてupsertで冪等)
も実行する。初回デプロイ後は誤って再実行しないよう `RUN_SEED_ON_BOOT` を外すか
`false` にしておくこと (実害はないが不要な処理を避けるため)。

## デプロイ構成 (Railway API + Vercel フロントエンド)

APIは GitHub Actions (`.github/workflows/deploy.yml`) からRailwayへデプロイする。
**検証環境は `claude/ove-wallet-platform` へのpushで自動、本番は手動実行のみ**
(下記「自動デプロイと手動デプロイの境目」)。フロントエンド (`apps/user-wallet` /
`apps/admin-wallet`) はVercel CLIによるCI経由デプロイを試みたが、pnpmモノレポとの
相性問題 (依存関係トレース失敗、`vercel deploy`のアップロード範囲がカレント
ディレクトリ配下に限定される問題等) を繰り返し起こしたため、**Vercelダッシュボードの
GitHubリポジトリインポート機能によるGit連携デプロイ**に切り替えた。Vercelの
Git連携はモノレポを丸ごとクローンしたうえでRoot Directory設定に従ってビルドする
ため、CLIで起きていた「モノレポの一部だけがアップロードされる」問題が発生しない。

### APIのデプロイ (GitHub Actions)

**背景**: 開発コンテナのネットワークポリシーが `backboard.railway.com` への
直接アクセスを禁止しているため、Claude Codeのセッション内から直接 `railway`
CLIでデプロイすることができない。そのため、実際のデプロイ操作はGitHub Actionsの
ランナー上 (別ネットワーク環境) で行う構成にした。

#### 必要なGitHub Secrets

| Secret名 | 内容 |
|---|---|
| `RAILWAY_API_TOKEN` | Railwayのアカウントレベルトークン (Account Settings → Tokens) |
| `RAILWAY_PROJECT_ID` | 初回実行後にRailwayが払い出すプロジェクトID (下記参照。初回のみ未設定でよい) |
| `SESSION_SECRET` | セッションCookie署名用のランダム値 (`openssl rand -hex 32`) |
| `ENCRYPTION_KEY` | MFAシークレット・外部API署名シークレットの暗号化キー (`openssl rand -hex 32`) |
| `SEED_ADMIN_PASSWORD` | 初期SUPER_ADMINのパスワード (任意の強いパスワード) |

これらは `RAILWAY` という **GitHub Environment** に登録されている。本番環境は
`Production` という別のEnvironmentに**同じ名前で別の値**を登録し、ワークフローの
`target` 入力で切り替える (`docs/runbooks/production-launch.md`)。

#### 実行フロー

1. **初回実行**: `RAILWAY_PROJECT_ID` 未設定の状態で実行すると、`deploy-api` ジョブが
   新規Railwayプロジェクトを作成し、ログにプロジェクトIDを出力する。このIDを
   `RAILWAY_PROJECT_ID` としてGitHub Secretsに登録する (以降の実行で同じプロジェクトを
   再利用するために必須)。
2. **2回目以降の実行**: `RAILWAY_PROJECT_ID` を登録した状態で再実行すると、
   `deploy-api` (既存プロジェクトへのリンク・PostgreSQL/Redisの確認・APIのビルド&
   デプロイ・公開ドメイン発行・ヘルスチェック待機) が実行される。
3. フロントエンドのVercel URLが決まったら (下記参照)、同じワークフローを
   `app_url`/`admin_url` 入力欄にそれぞれのURLを指定して再実行する。
   `update-api-cors` ジョブが走り、API側の `APP_URL`/`ADMIN_URL` (CORS許可オリジン)
   を更新してAPIを再起動する。

#### 自動デプロイと手動デプロイの境目

| | 検証環境 (staging) | 本番 (production) |
|---|---|---|
| 起動方法 | `claude/ove-wallet-platform` へのpush | Actionsからの手動実行のみ |
| GitHub Environment | `RAILWAY` | `Production` |
| `NODE_ENV` | `staging` | `production` |
| `RUN_SEED_ON_BOOT` | `false` 固定 | 実行時に選択 (初回のみ`true`推奨) |
| `APP_URL`/`ADMIN_URL` | 変更しない (Railway側の既存値を維持) | 入力必須。`update-api-cors`で更新 |

**本番を自動にしていない理由**: `apps/api/docker-entrypoint.sh` がコンテナ起動時に
`prisma migrate deploy` を実行するため、マージがそのままDBマイグレーションの実行に
なる。検証環境で同じマイグレーションを先に通してから本番へ入れられるようにしている。

**自動実行される条件**: pushの変更ファイルがAPIのビルドに関わるパス
(`apps/api/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `tsconfig.base.json`, `railway.json`,
`.github/workflows/deploy.yml`) を含むときだけ走る。フロントエンドだけの変更で
APIコンテナを再起動しても意味がなく、短時間とはいえ無用な断が生じるため。
フロントエンドはVercelのGit連携で別途自動デプロイされる。

**CIの成功を待つ**: 自動実行のときは `wait-for-ci` ジョブが同じコミットに対する
CI (`ci.yml` の `test`) の完了を最大20分待ち、成功したときだけデプロイへ進む。
CIが失敗していればRailwayのビルドを始める前に中止する。
手動実行ではこの待ち合わせを行わない (CIが赤でも入れ直したい障害対応の経路のため)。

**入れ替わりを実際に確かめる**: `railway up --detach` はビルド完了を待たずに戻るため、
直後の `/health` は**まだ動いている旧コンテナ**に当たって200を返す。200かどうかだけを
見ていた頃は、検証環境の自動デプロイ (run #39) が**0秒で「成功」**していた。

そこでデプロイ前に `GIT_COMMIT_SHA` をサービス変数として渡し、`/health` が返す
`commit` (短縮SHA、`apps/api/src/health.controller.ts`) が**そのデプロイのコミットと
一致するまで**待つようにしている。一致しないうちは「まだ旧いコンテナが応答しています」
と出し続け、20分で失敗する。

稼働中のビルドは誰でも確認できる。

```
$ curl -s https://api.sennokuni-wallet.com/health
{"status":"ok","timestamp":"...","commit":"db819d7"}
```

**同時実行しない**: `concurrency` でデプロイ先ごとに直列化している。
進行中のデプロイは打ち切らない (マイグレーション途中で止めるとDBが中途半端な
状態で残るため)、後続のデプロイが待機する。

### フロントエンドのデプロイ (Vercelダッシュボード)

`user-wallet`/`admin-wallet` それぞれについて、Vercelダッシュボードで以下の手順を行う
(このリポジトリを操作するセッションからは実行できないため、ユーザー側での作業が必要)。

1. [Vercel Dashboard](https://vercel.com/new) → **Add New → Project** →
   このGitHubリポジトリ (`stockbusiness/ovewwallet`) をImport する。
   同じリポジトリに対して**2つ**プロジェクトを作成する (user-wallet用・admin-wallet用)。
2. インポート時の設定画面で:
   - **Root Directory**: `apps/user-wallet` (もう一方は `apps/admin-wallet`) を指定する
     (「Edit」→ 該当ディレクトリを選択)。
   - **Framework Preset**: Next.js が自動検出される。
   - **Build Command / Install Command**: デフォルトのままでよい
     (Root Directoryにpnpm-lock.yamlがモノレポルートにあることをVercelが検出し、
     自動的にpnpmでインストールする)。
3. **Environment Variables** に `NEXT_PUBLIC_API_URL` を追加し、Railwayでデプロイした
   APIのURL (例: `https://api-production-xxxx.up.railway.app`) を設定する
   (Production環境のみでよい)。
4. **Deploy** をクリックすると、Vercelが自動的にビルド・デプロイを行う。
   完了後に表示される本番URL (`https://<project-name>-xxxx.vercel.app` または
   カスタムドメイン) を控えておく。
5. 以降、このリポジトリの対象ブランチ (Vercelプロジェクト設定の
   **Production Branch**で指定したブランチ) にpushするたびに、Vercelが自動的に
   再ビルド・再デプロイする (GitHub Actionsを経由する必要はない)。
6. 2つのURLが揃ったら、上記「APIのデプロイ」手順3の通り、`deploy.yml` を
   `app_url`/`admin_url` を指定して再実行し、APIのCORS設定を更新する。

### このデプロイの制約

- `AUTH_MODE=mock` で起動する。戦国パスポートSSOは相手方のAPI仕様が未確定のため
  本番連携が未実装 (`docs/authentication.md`参照)。LINEログインは本番実装
  (`LineIdTokenVerifier`) をコードとしては実装済みだが、実LINEチャネルでの結合
  テストが未実施のため、`NODE_ENV=production` は設定しない
  (`assertAuthModeSafeForProduction` のガードに引っかかるうえ、戦国パスポートSSOは
  `AUTH_MODE=production` にしても実装自体はモックのままで実態と合わなくなるため)。
  つまりこのデプロイは動作確認用であり、実ユーザー向けの本番公開ではない。
  実チャネルでのLINE結合テストが済み、戦国パスポートSSOも実装され次第、
  `AUTH_MODE=production` + `LINE_CHANNEL_ID` 設定への切り替えを検討する。
- PostgreSQL/Redisのサービス名検出 (`postgres`/`redis` を含む名前で判定) や
  変数名 (`DATABASE_URL`/`REDIS_URL`) は、Railwayの標準テンプレートの命名を
  前提にしている。将来Railway側の命名規則が変わった場合はワークフローの調整が
  必要になる可能性がある。

## Swagger

`apps/api` 起動後、`http://localhost:4000/api/docs` でOpenAPI定義を確認できる。
