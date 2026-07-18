# 監視・アラート

実運用ギャップ調査 (2026-07-17) で「監視・アラートが皆無」と指摘された項目への対応。
このドキュメントは「コードとして自動化済みのもの」と「Sentry/外部サービスのアカウント
契約など、人手による設定が別途必要なもの」を明確に分ける。

## 1. エラートラッキング (Sentry) — 設定・動作確認完了 (2026-07-18)

- `apps/api/src/common/sentry.ts` の `initSentry()` / `captureException()`。
- `SENTRY_DSN` 環境変数が未設定の場合は何もしない (Feature Flagと同じ「設定するまでは
  既存動作を変えない」方針)。
- `apps/api/src/main.ts` の起動時に `initSentry()` を呼ぶ。
- `apps/api/src/common/ledger-exception.filter.ts` の最終フォールバック
  (想定外の例外 = 5xxとして返す箇所) で `captureException(exception)` を呼ぶ。
  4xx (バリデーションエラー・見つからない・競合など、業務上想定内のエラー) は送信しない。
- 単体テスト: `apps/api/src/common/sentry.test.ts` (`SENTRY_DSN`未設定/設定済みの両方を
  `@sentry/node` をモックして検証)。

**進捗 (2026-07-17〜18)**: Sentryプロジェクト作成 (Nest.js、Error Monitoringのみ有効化・
Logging/Tracing/Profiling/Application Metricsは無効のまま) 完了。`.github/workflows/deploy.yml`
に `SENTRY_DSN` を `secrets.SENTRY_DSN` から設定する行を追加し、GitHub Actionsシークレット
登録・`deploy.yml`実行によるRailwayへの反映まで完了。実際にAPI (`POST /api/v1/auth/line/login`
へ`idToken: "mock."`という不正な値を送信し、モック検証ロジック内の未捕捉`Error`を意図的に
発生させるテスト) にリクエストを送り、SentryのIssue一覧に「invalid LINE id token」の
Issueが表示されることを確認済み。データを変更しない安全なテスト方法。

**残作業 (人手が必要)**:
1. Sentry側でアラートルール (例: 1分間に5件以上の新規Issueでメール/Slack通知) を設定する。
2. apps/user-wallet・apps/admin-wallet (Next.js, Vercel) のクライアント/サーバー側エラーは
   今回は対象外。必要になったら `@sentry/nextjs` を追加する (同様にDSN未設定時はno-opにする)。

## 2. ヘルスチェック — 実装済み・Railwayの自己監視のみ

- `apps/api` の `GET /health` (`apps/api/src/health.controller.ts`)。
- `railway.json` の `healthcheckPath` に設定済みで、Railwayが自動的にこのエンドポイントを
  ポーリングし、失敗が続くとデプロイを失敗扱いにする/`restartPolicyType: ON_FAILURE`で
  再起動する。

**残作業 (人手が必要)**:
- 外部の死活監視 (UptimeRobot / Better Uptime 等) に `GET /health` を登録し、
  Railwayの自己監視とは独立した第三者視点でのダウン検知・アラートを用意する。
  Railway自体が落ちた場合はRailway自身の監視は機能しないため、外部からの監視が必要。

## 3. ログ収集 — 未着手

- 現状は構造化ログ (NestJS Logger) を標準出力に出しているのみで、収集・検索基盤には
  送っていない。Railwayのログはコンテナ再起動やデプロイでロールオーバーし、長期保持されない。
- **残作業**: Railwayのログドレイン機能 (Logtail / Datadog / Better Stack 等への転送) を
  契約・設定する。監査ログ (`audit_logs` テーブル、DBレベルで削除・変更不可) とは別物であり、
  こちらはアプリケーションの動作ログ (エラー・警告・アクセスログ) が対象。

## 4. CI (push/PR時の自動lint・build・test) — 実装済み

- `.github/workflows/ci.yml`: `push` (main) / `pull_request` のたびに、テスト用
  PostgreSQL/Redis (GitHub Actions services) を使って `pnpm db:migrate:test` →
  `pnpm build` → `pnpm lint` → `pnpm test` を自動実行する。これまで`.github/workflows/deploy.yml`
  (手動実行のみ) しか無かった状態への対応。
- `apps/admin-wallet`・`apps/user-wallet` の `lint` (`next lint`) はESLint設定
  (`eslint-config-next`等) が未導入のため、対話プロンプトを要求してCIでは失敗する。
  CIのlintステップはこの2アプリを除外して実行している (型チェック自体は同じCI内の
  `pnpm build` に含まれる `next build` で行われるため、型の安全性は担保されている)。
  **残作業**: 2アプリへESLint設定を追加し、`next lint` を実際に有効化する
  (未着手・既存コードに対する指摘件数が未知数のため、別タスクとして切り出す)。

## 5. 対象外・意図的に見送ったもの

- APM (レイテンシ・スループットの継続計測): `tracesSampleRate: 0` でSentryのトレース機能は
  無効化している。トラフィック規模が明確になってから必要性を再検討する。
- Prisma/PostgreSQLのスロークエリ監視: 現時点では未設定。DBバックアップ整備
  (`docs/backup.md`) と合わせて、運用開始後の課題として別途検討する。
