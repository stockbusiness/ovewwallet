# 本番環境の立ち上げ手順

検証用デプロイとは**別のRailwayプロジェクト**に本番環境を作る手順。

## なぜ環境を分けるのか

検証用デプロイのDBには、動作確認で作られたアカウント・取引が入っている。
**`ove_transactions` はDBトリガーで削除できない** (設計どおり、`docs/database.md`)。
同じDBを本番に使うと、ポイント負債レポート (`docs/point-liability.md`) の数字が
最初から検証データを含み、後から取り除けない。

## 前提: 稼働開始時点で使えるログイン方法

**LINEログインのみ** (`docs/login-methods.md`)。

- メールOTP: **送信基盤が未実装**。本番ではコードが誰にも届かない
- 千ノ国パスポートSSO: 正式SSO (RS256/JWKS) が未完成
- 代理店SSO: `SENGOKU_AI_SSO_*` 未接続

デプロイワークフローがこれらを明示的に `false` に設定する。

## 手順

### 1. Railwayプロジェクトを作る

Railwayのダッシュボードで新規プロジェクトを作成する (例: `ove-wallet-production`)。

**ワークフローに自動作成させない。** 再実行のたびに本番プロジェクトが増えるのを防ぐため、
`target=production` では既存プロジェクトIDを必須にしてある。

### 2. `Production` という GitHub Environment を作る

検証用のSecretは `RAILWAY` という **GitHub Environment** に入っている
(Settings > Environments > RAILWAY)。本番のSecretを**同じEnvironmentに入れてはいけない**。
1つのEnvironmentは1つの名前につき1つの値しか持てないため、同じ場所に入れると
`SESSION_SECRET` と `ENCRYPTION_KEY` が検証用と同じ値になってしまう。
検証環境の値が漏れたとき、本番のセッションと暗号化データまで影響が及ぶ。

そこで**もう1つEnvironmentを作る**。Secret名は検証用とまったく同じで、値だけが違う。
ワークフローは `target` に応じて参照するEnvironmentを切り替える。

**Settings > Environments > New environment** で `Production` という名前で作成し、
`Environment secrets` に以下を登録する。

> 名前は**ワークフローの記述と完全に一致させる**こと (`Production`)。
> 変えたい場合は `deploy.yml` / `backup-db.yml` / `restore-drill.yml` の
> `environment:` 式も同時に直す。

| Secret | 内容 |
|---|---|
| `RAILWAY_API_TOKEN` | 検証用と同じ値でよい (アカウント全体のトークンのため)。分からなければ下記を参照 |
| `RAILWAY_PROJECT_ID` | **手順1で作った本番プロジェクトのID**。検証用プロジェクトを指さないこと |
| `SESSION_SECRET` | `openssl rand -hex 32`。検証用と**別の値** |
| `ENCRYPTION_KEY` | `openssl rand -hex 32`。検証用と**別の値** |
| `SEED_ADMIN_PASSWORD` | 初期管理者のパスワード。初回デプロイ後に変更する |
| `SENTRY_DSN` | 未登録でもデプロイは通る (`initSentry()` が空なら何もしない) |

`VERCEL_TOKEN` はこのワークフローでは使わない (フロントエンドはVercelのGit連携で
デプロイする、`docs/deployment.md`)。

#### `RAILWAY_API_TOKEN` の取り方

GitHubのSecretは登録後に値を読み出せないため、検証用の値が手元にない場合は
**新しく発行する**。既存のトークンは無効にならないので、検証環境には影響しない。

1. Railway の **Account Settings → Tokens** (<https://railway.com/account/tokens>)
2. トークン名を入力する (例: `github-actions-production`)
3. **Workspace (Team) の欄は空のままにする。**
   ここでワークスペースを選ぶと**チームスコープのトークン**になり、`railway whoami` が
   `Unauthorized` で失敗する。whoamiはアカウント情報を読むコマンドで、チームトークンには
   そのアカウント情報が紐づいていないため。**必要なのはアカウントスコープのトークン**で、
   それはWorkspaceを選ばずに発行したものを指す
4. 表示は1回だけなのでその場でコピーし、`Production` Environment に登録する

> Workspaceの欄は「自分のプロジェクトがあるワークスペース」を選びたくなるが、**選んではいけない**。
> 空のままがアカウントスコープになる。

#### トークンは3種類ある

| 種類 | 発行場所 | 環境変数名 | このワークフロー |
|---|---|---|---|
| **アカウントスコープ** | Account Settings > Tokens (Workspace欄は空) | `RAILWAY_API_TOKEN` | **これを使う** |
| チームスコープ | Account Settings > Tokens (Workspaceを選択) | `RAILWAY_API_TOKEN` | `whoami` が失敗する |
| プロジェクトトークン | プロジェクトの Settings > Tokens | `RAILWAY_TOKEN` | 変数名が違うので使えない |

トークンが正しいかは、デプロイの `Authenticate` ステップ (`railway whoami`) が
実行直後に判定する。誤っていればそこで止まるので、他の設定には波及しない
(Railway側には何も作られない)。

> **`ENCRYPTION_KEY` を後から変えるときは、値の差し替えだけでは足りない。**
> 管理者MFAシークレット等が旧鍵で暗号化されたまま復号できなくなる。
> `pnpm --filter @ove/database rotate-encryption-key` で全件を再暗号化する手順が
> 必要 (`docs/deployment.md`「ENCRYPTION_KEYのローテーション」)。
> 稼働開始前に確定させておくほうが手間がない。
>
> 値の形式に制約はない (`scryptSync` で32byte鍵を導出するため、base64でもhexでもよい)。

登録漏れは `Validate inputs` ステップが**名前を挙げて**止める (すべての不足を
1回で報告するので、1つずつ再実行する必要はない)。

#### 誤操作を防ぎたい場合

`Production` Environment に **Required reviewers** を設定すると、本番デプロイの前に
承認ステップが入る。検証用の `RAILWAY` には影響しない。

### 3. フロントエンドのURLを決める

`APP_URL` / `ADMIN_URL` は **CORSとCSRFの許可オリジンの唯一の入力**であり、
`NODE_ENV=production` では未設定だと**起動時に失敗する**
(`apps/api/src/common/assert-production-env.ts`)。

そのためワークフローは `target=production` のとき両方を必須にしており、
**デプロイ前に**設定する (後段のジョブでは初回起動に間に合わないため)。

独自ドメインを使う場合はDNSとVercel側の設定を先に済ませ、確定したURLを渡す。
暫定的にVercelの本番URLで開始することもできる (後から再実行して差し替え可能)。

**Vercelの本番URLはAPIより先に決まっている**ので、順番で詰まることはない。
Vercelダッシュボードで各プロジェクトの Production Deployment のURLを控える
(`https://<project>.vercel.app` 形式)。

#### 独自ドメイン (`sennokuni-wallet.com`) の割り当て

| ホスト | 向き先 | 設定場所 |
|---|---|---|
| `sennokuni-wallet.com` | Vercel `ovewwallet-user-wallet` | Vercel > Settings > Domains |
| `admin.sennokuni-wallet.com` | Vercel `ovewwallet-admin-wallet` | 同上 |
| `api.sennokuni-wallet.com` | Railway の `api` サービス | Railway > api > Settings > Networking |

ドメイン名自体が「wallet」なので、利用者向けは `wallet.` を足さず**apex (裸ドメイン)** を
使う。`www` は apex へリダイレクトさせておく (Vercelが設定を案内する)。

APIをサブドメインにするのは **admin-wallet のCookieを同一サイトにする**ため。
user-wallet は `next.config.mjs` の `rewrites()` で `/api/*` を同一オリジンに
見せかけて転送するのでAPIのホスト名はブラウザから見えないが、**admin-wallet には
この仕組みがなく** `NEXT_PUBLIC_API_URL` を絶対URLとして直接呼ぶ
(`apps/admin-wallet/src/lib/api.ts`)。Railwayの `*.up.railway.app` のままでも
稼働はできるが、クロスサイトCookie (`SameSite=None`) に依存し続けることになる。

そのため各URLは次の値になる。

| 入力 / 変数 | 値 |
|---|---|
| `app_url` | `https://sennokuni-wallet.com` |
| `admin_url` | `https://admin.sennokuni-wallet.com` |
| `NEXT_PUBLIC_API_URL` | `https://api.sennokuni-wallet.com` |

### 3-2. フロントエンド側の環境変数 (Vercel)

APIを立てただけではフロントエンドは本番APIを見ない。**Vercel側の設定が必要**で、
これが漏れると画面は表示されるのにログインできない、という分かりにくい形で失敗する。

Vercelの各プロジェクト > **Settings > Environment Variables** で、
**Environment に `Production` を選んで**登録する
(`Preview` と分けておけば、PRのプレビューは検証用APIを向いたまま残せる)。

対象プロジェクトは **`ovewwallet-user-wallet`** と **`ovewwallet-admin-wallet`** の2つ。
Vercelには `user-wallet` / `admin-wallet` という**Git連携の切れた古いプロジェクト**も
残っているので取り違えないこと。

| プロジェクト | 変数 | 値 |
|---|---|---|
| `ovewwallet-user-wallet` | `NEXT_PUBLIC_API_URL` | `https://api.sennokuni-wallet.com` |
| `ovewwallet-user-wallet` | `NEXT_PUBLIC_LINE_LIFF_ID` | LIFF ID (`2010749243-Zu7AV5nR`。`docs/roadmap.md` P0-3.6) |
| `ovewwallet-admin-wallet` | `NEXT_PUBLIC_API_URL` | `https://api.sennokuni-wallet.com` |

APIに独自ドメインを割り当てない場合は、手順4のログに出るRailwayのURLを使う。

> **`NEXT_PUBLIC_*` はビルド時に埋め込まれる。** 値を変えたら**再デプロイが必要**で、
> 環境変数を保存しただけでは反映されない。

既存のVercelプロジェクトをそのまま使う場合、**いまの検証用フロントエンドが
本番フロントエンドになる**。検証用APIを画面から触りたければ、`Preview` スコープに
検証用APIのURLを残しておけばPRプレビューから引き続き使える。完全に分けたい場合は
Vercelプロジェクトを別に作る (その場合は `app_url`/`admin_url` にも新しい方のURLを渡す)。

#### `NEXT_PUBLIC_LINE_LIFF_ID` が未設定だとログインできない

未設定の場合、`apps/user-wallet/src/lib/liff.ts` の `isLiffConfigured()` が false を返し、
ログイン画面は**モック実装** (`mock.<疑似ID>` を送信) に切り替わる
(`docs/authentication.md`)。一方 本番APIは `AUTH_MODE=production` で
`LineIdTokenVerifier` が実チャネルのIDトークンを検証するため、モックのトークンは
必ず拒否される。**稼働開始時点で使えるログイン方法はLINEのみ**なので、
これは「誰もログインできない」状態になる。

`api.sennokuni-wallet.com` を先にRailwayへ割り当てておけば、APIのURLは手順4の前に
確定するので後追いにならない。Railwayの発行URLを使う場合だけ、手順4を実行して
URLを得てから設定し、Vercelで再デプロイする。

#### LINE Developers 側

LIFFアプリの **Endpoint URL** を **`https://sennokuni-wallet.com/login`** に更新する。

**ここを忘れるとLINEログインが失敗する。** Endpoint URL以外のリダイレクト先を渡すと
トークン交換が落ちることを実チャネルで確認済み (`docs/authentication.md`)。
LIFF SDKは登録済みのEndpoint URLをそのままOAuthの `redirect_uri` として使う。

### 4. デプロイする

**本番デプロイは手動実行のみ。** `claude/ove-wallet-platform` へのpushで自動デプロイ
されるのは検証環境 (`RAILWAY` Environment) だけで、本番は下記の手順を踏まないと
反映されない (`docs/deployment.md`「自動デプロイと手動デプロイの境目」)。

GitHub Actions → **Deploy (Railway API)** → Run workflow

| 入力 | 値 |
|---|---|
| `target` | `production` |
| `app_url` | `https://sennokuni-wallet.com` |
| `admin_url` | `https://admin.sennokuni-wallet.com` |
| `run_seed_on_boot` | **初回は `true`** |

ワークフローが PostgreSQL / Redis / api サービスを作り、環境変数を設定してデプロイし、
`/health` が200を返すまで待つ。

### 5. 初回デプロイ後にやること

1. **初期管理者でログインする**

   | 項目 | 値 |
   |---|---|
   | メールアドレス | `admin@ovewallet.local` (`packages/database/src/seed.ts` の固定値) |
   | パスワード | `Production` Environment の `SEED_ADMIN_PASSWORD` |

2. **自分のメールアドレスの管理者に置き換える**

   初期管理者のメールアドレスは実在しないドメインで、**メールアドレスは後から変更できない**
   (`UpdateAdminUserSchema` が受け付けるのは表示名・ロール・状態のみ)。管理画面の
   **設定 > 管理者アカウント**で以下を行う。

   1. 自分のメールアドレスでスーパー管理者を追加する
   2. 表示された初期パスワードを控える (**この1回しか表示されない**)
   3. ログアウトし、追加したアカウントでログインし直す
   4. **設定 > セキュリティ設定**でパスワードを変更する
   5. 初期管理者 (`admin@ovewallet.local`) を停止する

   > 最後の有効なスーパー管理者は停止・降格できないようAPI側で保護されている
   > (`admin-users.test.ts`)。順番を間違えても締め出されることはない。

3. **管理者MFAを有効化する** (設定 > セキュリティ設定、`docs/authentication.md`)
4. **`run_seed_on_boot` を `false` にして再実行する**
   起動のたびにseedを走らせる必要はなく、`SEED_ADMIN_PASSWORD` を環境変数に
   置き続けないため
5. **Vercelに `NEXT_PUBLIC_API_URL` を設定して再デプロイする** (手順3-2)
   本番APIのURLは手順4のログに出る。設定しないとフロントは検証用APIを向いたまま
6. **LINE Developers のコールバックURLを本番ドメインに登録する** (手順3-2)
7. **AIアート教室の案内先URLを設定する** (`docs/reward-landing-url.md`)
8. **バックアップの対象を本番に切り替える** — 下記

### 5-2. バックアップの対象を切り替える (忘れやすい)

`backup-db.yml` (日次) と `restore-drill.yml` (月次) は、**リポジトリ変数
`BACKUP_TARGET`** で対象を決める。未設定だと検証環境のDBをバックアップし続け、
**本番のDBは一度もバックアップされない**。

**Settings > Secrets and variables > Actions** の **Variables** タブで登録する
(Environment側の `Environment variables` ではなく、**リポジトリ変数**):

| Variable | 値 |
|---|---|
| `BACKUP_TARGET` | `production` |

切り替えたら `backup-db.yml` を手動実行し、ログの「対象: production」と
artifactのサイズを確認する。

> 定期実行 (schedule) には実行時の入力を渡せないため、`deploy.yml` の `target` 入力
> とは別に永続的な変数で切り替える。

### 5-3. ビルドがrailpackで失敗する場合

Railwayの既定のビルド方法は **railpack による自動判定**で、このモノレポは
「Nx workspace with a Next.js app」と誤認される。初回デプロイで
`RAILPACK_NX_APP を設定してください` というエラーが出た場合はこれが原因。

ワークフローは api サービスに次の変数を設定してDockerfileビルドに固定するので、
通常は意識しなくてよい。

| 変数 | 値 |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` |

手動で直す場合は Railway の api サービス > **Variables** に同じ変数を追加し、
再デプロイする。

> リポジトリルートの `railway.json` も `builder: "DOCKERFILE"` を指定しているが、
> 空サービスとして作った service には効かなかった。Config as Code (railway.json)
> 自体も2026-12-01で廃止予定という警告が出るため、サービス変数で明示する。

### 6. 動作確認

| 確認項目 | 期待 |
|---|---|
| `GET /health` | 200 |
| `GET /api/v1/auth/methods` | `{"line":true,"email":false,"sengoku_passport":false,"agency":false}` |
| ログイン画面 | LINEボタンのみ表示される |
| LINEログイン | 実際にLINEへ遷移して戻り、ウォレット画面が表示される (モックに落ちていない) |
| `POST /api/v1/auth/sso/sengoku/dev-issue` | 404 (本番で無効) |
| 起動ログ | 7つの定期ジョブが登録されている (`docs/runbooks/scheduled-jobs.md`) |

## 立ち上げ後に残る作業

| 項目 | 備考 |
|---|---|
| 外形監視の契約 | `/health` はレート制限の対象外 |
| ログドレインの契約 | 定期ジョブの結果が全てログに出る |
| Sentryアラートルール | `SENTRY_DSN` 設定後 |
| バックアップの確認 | 手順5-2で `BACKUP_TARGET=production` にした上で1回手動実行する |
| 代理店連携の有効化 | APIキー発行 + `ENABLE_AGENCY_REFERRAL_SYNC=true` (`docs/agency-integration.md`) |
| 代理店からのORI付与の有効化 | `ENABLE_AGENCY_POINT_AWARD_INBOX=true` + 管理画面で `system_key` を `orly-wallet` にする (`docs/integration/AGENCY_POINT_AWARD.md`) |
| 匿名化の有効化 | 法務の回答後 (`docs/account-anonymization.md`)。**既定OFFなので何も消えない** |
| 連携サービス画面の公開 | 連携先とサービス名が確定したら `ENABLE_LINKED_SERVICES=true` (下記) |

## 連携サービス画面を隠している

稼働開始時点では連携先がすべて「未連携」で、サービス名 (`SENGOKU_EC` 等) も確定して
いないため、`/wallet/services` とその導線 (ホームのタイル・メニュー) を
**`ENABLE_LINKED_SERVICES` で隠している**。他のFeature Flagと同様に既定OFF。

隠しているのは**画面だけ**で、連携そのもの (`/api/v1/me/linked-services` や外部サービス
連携の実処理) は動いている。

公開するときは Railway の api サービスに `ENABLE_LINKED_SERVICES=true` を設定する。
フロントエンドは `GET /api/v1/me/feature-flags` の応答だけを見て出し分けるため、
**Vercelの再デプロイは不要**で、APIの再起動だけで反映される。


## 検証用デプロイは残す

`target=staging` (既定) で従来どおり動く。本番と別プロジェクト・別DBのため、
検証を続けながら本番を運用できる。
