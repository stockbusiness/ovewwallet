# 定期実行ジョブ (運用手順)

失効バッチ・整合性チェック・Outbox送信を自動実行する仕組み
(`apps/api/src/scheduler/`)。導入前はいずれも管理画面からの手動実行しか入口が無く、
押し忘れると次のような障害が**エラーにならないまま**発生していた。

- 有効期限が到来した獲得ORIが失効せず、残高と会計上の未使用残高が実態とずれる
- 代理店システム向けの連携イベントがキューに滞留し、相手方へ何も届かない
- 台帳と残高キャッシュの不整合が検知されない (Sentry通知の実装はあるが発火しない)

## ジョブ一覧

| ジョブ名 | 既定スケジュール (UTC) | 日本時間 | 呼び出す処理 |
|---|---|---|---|
| `credit-expiry` | `0 17 * * *` | 毎日 02:00 | `AdminRewardRulesService.runExpiryBatch()` |
| `reconciliation` | `0 20 * * *` | 毎日 05:00 | `AdminService.reconcile()` |
| `outbox-dispatch` | `*/5 * * * *` | 5分ごと | `OutboxService.processPendingEvents()` |

いずれも**管理画面の手動実行と同じサービスメソッド**を呼ぶ。手動と自動で挙動が
分かれないよう、スケジューラ側にロジックを複製していない。手動実行の入口
(管理画面のボタン) はこれまで通り残しており、臨時実行に使える。

日次ジョブの時刻は、日次DBバックアップ (`.github/workflows/backup-db.yml`、
18:00 UTC = 03:00 JST) と重ならないようにずらしてある。

## 環境変数

| 変数 | 既定 | 説明 |
|---|---|---|
| `SCHEDULER_ENABLED` | (未設定=有効) | `false` を明示したときのみ全ジョブを停止する |
| `EXPIRY_CRON` | `0 17 * * *` | 失効バッチのcron式 (5フィールド、UTC) |
| `RECONCILIATION_CRON` | `0 20 * * *` | 整合性チェックのcron式 |
| `OUTBOX_CRON` | `*/5 * * * *` | Outbox送信のcron式 |

Feature Flag (`ENABLE_*`) と異なり**既定で有効**にしている。これらは新機能ではなく
「本来ずっと動いているべき運用処理」であり、既定OFFにすると本番で有効化を忘れたときに
上記の障害が無言で再発するため。

自動テストでは無効化している (`.env.test` と `.github/workflows/ci.yml` の
`SCHEDULER_ENABLED=false`、Playwrightは `tests/e2e/playwright.config.ts` の
webServer env)。テスト中にcronが走ると、各テストが用意したデータをジョブが
書き換えてしまい結果が不安定になるため。

## 多重実行の防止

APIを複数インスタンスで動かすと、同じ時刻に全インスタンスのcronが起動する。
これを防ぐため、各ジョブはKVストア (Redis) 上のロックを取得してから実行する。

- ロックキー: `scheduler-lock:<ジョブ名>`、TTL 15分
- Redisの `INCR` が原子的で最初の1件だけが `1` を返す性質を利用する
  (`packages/auth/src/kv-store.ts`)
- ロックを取れなかったインスタンスは `skipped: another instance holds the lock` を
  ログに出して何もしない
- 実行後は必ずロックを解放する。プロセスごと落ちた場合もTTLで自動解放される

`REDIS_URL` 未設定時はインメモリ実装にフォールバックするが、その構成は単一
インスタンス前提のためプロセス内で排他できれば十分。

なお `outbox-dispatch` については、`OutboxService` 側でもイベント単位の
PENDING→PROCESSING条件付き更新による排他を行っているため、仮にロックをすり抜けても
同じイベントが二重送信されることはない。

## 動作確認

APIの起動ログに次の3行が出ていれば登録できている。

```
scheduled job "credit-expiry" registered (cron: 0 17 * * *)
scheduled job "reconciliation" registered (cron: 0 20 * * *)
scheduled job "outbox-dispatch" registered (cron: */5 * * * *)
```

実行のたびに結果がログに出る。ログドレインを設定済みならここで検索できる。

```
scheduled job "credit-expiry" finished in 812ms: wallets_processed=2 total_expired_amount=700
scheduled job "reconciliation" finished in 1503ms: checked=1284 mismatched=0
scheduled job "outbox-dispatch" finished in 240ms: processed=3 failed=0 batches=2
```

`SCHEDULER_ENABLED=false` で起動した場合は、代わりに次の警告が1行出る。
意図せずこの状態になっていないか、デプロイ後に確認すること。

```
scheduler is disabled (SCHEDULER_ENABLED=false): credit expiry / reconciliation / outbox dispatch will NOT run automatically
```

## 異常時の挙動

- **ジョブが失敗した場合**: エラーログを出して Sentry へ送り (`SENTRY_DSN` 未設定時は
  no-op)、プロセスは落とさない。次回のスケジュールで再実行される。
- **cron式が不正な場合**: そのジョブだけ登録に失敗し、エラーログと Sentry 通知を出す。
  他の2つは通常どおり登録される (設定ミス1つでAPI全体が起動不能になるのを避けるため)。
- **Outboxが滞留している場合**: 1回の実行で最大10バッチ (既定20件/バッチ = 200件) まで
  処理する。それ以上は次回に持ち越す。送信に失敗したイベントは指数バックオフで
  `available_at` が先送りされ、8回で `FAILED` (Dead Letter) になり Sentry 通知が出る。
  `FAILED` は自動では再送されないため、管理画面「外部連携キュー」から手動再送する。

## 関連ドキュメント

- `docs/credit-expiry.md` — ORI有効期限・失効の仕様
- `docs/integration-outbox.md` — Transactional Outbox
- `docs/ledger-rules.md` — 整合性チェックの考え方
- `docs/monitoring.md` — Sentry・ログ収集
