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

### 2. GitHub Secrets を登録する

| Secret | 内容 |
|---|---|
| `RAILWAY_PRODUCTION_PROJECT_ID` | 手順1で作ったプロジェクトのID (**本番用。検証用の`RAILWAY_PROJECT_ID`とは別**) |
| `SESSION_SECRET` | 32文字以上。検証用と**別の値**にする |
| `ENCRYPTION_KEY` | 検証用と**別の値**にする (`openssl rand -base64 32`) |
| `SEED_ADMIN_PASSWORD` | 初期管理者のパスワード。初回デプロイ後に変更する |
| `SENTRY_DSN` | 未登録でもデプロイは通る (`initSentry()` が空なら何もしない) |

> `SESSION_SECRET` と `ENCRYPTION_KEY` を検証用と共有しないこと。検証環境の値が漏れた
> 場合に本番のセッションと暗号化データまで影響が及ぶ。

### 3. フロントエンドのURLを決める

`APP_URL` / `ADMIN_URL` は **CORSとCSRFの許可オリジンの唯一の入力**であり、
`NODE_ENV=production` では未設定だと**起動時に失敗する**
(`apps/api/src/common/assert-production-env.ts`)。

そのためワークフローは `target=production` のとき両方を必須にしており、
**デプロイ前に**設定する (後段のジョブでは初回起動に間に合わないため)。

独自ドメインを使う場合はDNSとVercel側の設定を先に済ませ、確定したURLを渡す。
暫定的にVercelの本番URLで開始することもできる (後から再実行して差し替え可能)。

### 4. デプロイする

GitHub Actions → **Deploy (Railway API)** → Run workflow

| 入力 | 値 |
|---|---|
| `target` | `production` |
| `app_url` | user-walletのURL |
| `admin_url` | admin-walletのURL |
| `run_seed_on_boot` | **初回は `true`** |

ワークフローが PostgreSQL / Redis / api サービスを作り、環境変数を設定してデプロイし、
`/health` が200を返すまで待つ。

### 5. 初回デプロイ後にやること

1. **初期管理者でログインし、パスワードを変更する**
   (`SEED_ADMIN_PASSWORD` の値をそのまま使い続けない)
2. **管理者MFAを有効化する** (`docs/authentication.md`「管理画面MFA」)
3. **`run_seed_on_boot` を `false` にして再実行する**
   起動のたびにseedを走らせる必要はなく、`SEED_ADMIN_PASSWORD` を環境変数に
   置き続けないため
4. **LINE Developers のコールバックURLを本番ドメインに登録する**
5. **AIアート教室の案内先URLを設定する** (`docs/reward-landing-url.md`)

### 6. 動作確認

| 確認項目 | 期待 |
|---|---|
| `GET /health` | 200 |
| `GET /api/v1/auth/methods` | `{"line":true,"email":false,"sengoku_passport":false,"agency":false}` |
| ログイン画面 | LINEボタンのみ表示される |
| `POST /api/v1/auth/sso/sengoku/dev-issue` | 404 (本番で無効) |
| 起動ログ | 7つの定期ジョブが登録されている (`docs/runbooks/scheduled-jobs.md`) |

## 立ち上げ後に残る作業

| 項目 | 備考 |
|---|---|
| 外形監視の契約 | `/health` はレート制限の対象外 |
| ログドレインの契約 | 定期ジョブの結果が全てログに出る |
| Sentryアラートルール | `SENTRY_DSN` 設定後 |
| バックアップの確認 | `.github/workflows/backup-db.yml` / `restore-drill.yml` |
| 代理店連携の有効化 | APIキー発行 + `ENABLE_AGENCY_REFERRAL_SYNC=true` (`docs/agency-integration.md`) |
| 匿名化の有効化 | 法務の回答後 (`docs/account-anonymization.md`)。**既定OFFなので何も消えない** |

## 検証用デプロイは残す

`target=staging` (既定) で従来どおり動く。本番と別プロジェクト・別DBのため、
検証を続けながら本番を運用できる。
