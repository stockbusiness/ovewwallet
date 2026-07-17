# 監視・アラート

実運用ギャップ調査 (2026-07-17) で「監視・アラートが皆無」と指摘された項目への対応。
このドキュメントは「コードとして自動化済みのもの」と「Sentry/外部サービスのアカウント
契約など、人手による設定が別途必要なもの」を明確に分ける。

## 1. エラートラッキング (Sentry) — コード実装済み・設定は未着手

- `apps/api/src/common/sentry.ts` の `initSentry()` / `captureException()`。
- `SENTRY_DSN` 環境変数が未設定の場合は何もしない (Feature Flagと同じ「設定するまでは
  既存動作を変えない」方針)。
- `apps/api/src/main.ts` の起動時に `initSentry()` を呼ぶ。
- `apps/api/src/common/ledger-exception.filter.ts` の最終フォールバック
  (想定外の例外 = 5xxとして返す箇所) で `captureException(exception)` を呼ぶ。
  4xx (バリデーションエラー・見つからない・競合など、業務上想定内のエラー) は送信しない。
- 単体テスト: `apps/api/src/common/sentry.test.ts` (`SENTRY_DSN`未設定/設定済みの両方を
  `@sentry/node` をモックして検証)。

**残作業 (人手が必要)**:
1. Sentryでプロジェクトを作成し、DSNを払い出す。
2. Railway (apps/api) の環境変数に `SENTRY_DSN` を設定する。
3. Sentry側でアラートルール (例: 1分間に5件以上の新規Issueでメール/Slack通知) を設定する。
4. apps/user-wallet・apps/admin-wallet (Next.js, Vercel) のクライアント/サーバー側エラーは
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

## 4. 対象外・意図的に見送ったもの

- APM (レイテンシ・スループットの継続計測): `tracesSampleRate: 0` でSentryのトレース機能は
  無効化している。トラフィック規模が明確になってから必要性を再検討する。
- Prisma/PostgreSQLのスロークエリ監視: 現時点では未設定。DBバックアップ整備
  (`docs/backup.md`) と合わせて、運用開始後の課題として別途検討する。
