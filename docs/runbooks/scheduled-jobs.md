# 定期実行ジョブ (運用手順)

失効バッチ・整合性チェック・Outbox送信を自動実行する仕組み
(`apps/api/src/scheduler/`)。導入前はいずれも管理画面からの手動実行しか入口が無く、
押し忘れると次のような障害が**エラーにならないまま**発生していた。

- 有効期限が到来した獲得ORIが失効せず、残高と会計上の未使用残高が実態とずれる
- 代理店システム向けの連携イベントがキューに滞留し、相手方へ何も届かない
- 台帳と残高キャッシュの不整合が検知されない (Sentry通知の実装はあるが発火しない)
- 失効間近のORIについて何の予告もなく、利用者は残高が減ってから気づく

## ジョブ一覧

| ジョブ名 | 既定スケジュール (UTC) | 日本時間 | 呼び出す処理 |
|---|---|---|---|
| `credit-expiry` | `0 17 * * *` | 毎日 02:00 | `AdminRewardRulesService.runExpiryBatch()` |
| `data-retention` | `30 19 * * *` | 毎日 04:30 | `DataRetentionService.purgeExpiredData()` |
| `reconciliation` | `0 20 * * *` | 毎日 05:00 | `AdminService.reconcile()` |
| `outbox-dispatch` | `*/5 * * * *` | 5分ごと | `OutboxService.processPendingEvents()` |
| `expiry-notice` | `0 1 * * *` | 毎日 10:00 | `ExpiryNoticeService.createExpiryNotices()` |
| `liability-snapshot` | `0 0 2 * *` | 毎月2日 09:00 | `PointLiabilityService.captureMonthEndSnapshot()` |

`expiry-notice` を除き、いずれも**管理画面の手動実行と同じサービスメソッド**を呼ぶ。手動と自動で挙動が
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
| `RETENTION_CRON` | `30 19 * * *` | データ保持ジョブのcron式 |
| `EXPIRY_NOTICE_CRON` | `0 1 * * *` | 失効予告のcron式 (通知が深夜に出ないよう日中に寄せている) |
| `EXPIRY_NOTICE_DAYS_BEFORE` | `7` | 失効の何日前に予告するか (正の整数以外は既定値) |
| `LIABILITY_SNAPSHOT_CRON` | `0 0 2 * *` | 月末ポイント負債スナップショットのcron式 |
| `USER_SESSION_RETENTION_DAYS` | `90` | 期限切れセッションを期限切れ後どれだけ残すか |
| `API_ACCESS_LOG_RETENTION_DAYS` | `180` | 外部APIアクセスログをどれだけ残すか |
| `OUTBOX_SENT_RETENTION_DAYS` | `90` | 送信済みOutboxイベントをどれだけ残すか |

保持日数は正の整数として解釈できない値を設定した場合、既定値にフォールバックする
(設定ミスで0日になり必要なデータまで消えるのを避けるため)。

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

APIの起動ログに次の5行が出ていれば登録できている。

```
scheduled job "credit-expiry" registered (cron: 0 17 * * *)
scheduled job "reconciliation" registered (cron: 0 20 * * *)
scheduled job "outbox-dispatch" registered (cron: */5 * * * *)
scheduled job "data-retention" registered (cron: 30 19 * * *)
scheduled job "expiry-notice" registered (cron: 0 1 * * *)
scheduled job "liability-snapshot" registered (cron: 0 0 2 * *)
```

実行のたびに結果がログに出る。ログドレインを設定済みならここで検索できる。

```
scheduled job "credit-expiry" finished in 812ms: wallets_processed=2 total_expired_amount=700
scheduled job "reconciliation" finished in 1503ms: checked=1284 mismatched=0
scheduled job "outbox-dispatch" finished in 240ms: processed=3 failed=0 batches=2
scheduled job "expiry-notice" finished in 96ms: accounts_notified=12 lots_marked=15
```

`SCHEDULER_ENABLED=false` で起動した場合は、代わりに次の警告が1行出る。
意図せずこの状態になっていないか、デプロイ後に確認すること。

```
scheduler is disabled (SCHEDULER_ENABLED=false): credit expiry / reconciliation / outbox dispatch will NOT run automatically
```

## データ保持ジョブが消すもの・消さないもの

| テーブル | 扱い |
|---|---|
| `user_sessions` | 有効期限切れから保持期間を過ぎた行を削除。ログインデバイス一覧は元から期限切れを除外して表示しているため、利用者から見える情報は変わらない |
| `api_access_logs` | 記録から保持期間を過ぎた行を削除 |
| `integration_outbox` | **送信済み(SENT)のみ**削除。PENDING/PROCESSINGは未送信、FAILEDは人手の対応待ちのため、古くても残す |
| `audit_logs` / `ove_transactions` | **削除しない**。DBトリガーでDELETE自体を禁止しており(設計どおり)、長期保管が前提。削除ではなくアーカイブ方針を別途決める |
| `inbound_events` | **削除しない**。外部イベントの重複受信を防ぐ記録で、古い行を消すと同じ`event_id`の再送で二重処理(報酬の二重付与など)になりうる。表のサイズより取り違えの実害が大きいため対象外とした |

一度に大量削除すると長時間ロックを保持するため、1000件ずつ・1テーブルあたり最大20回
(2万件) に分けて実行する。上限に達した分は警告ログを出して次回の実行に持ち越す。

保持期間の既定値は「調査に必要な期間は残しつつ無限に増やさない」ことを狙った暫定値。
法令・社内規程で保持期間が定まったら上記の環境変数で上書きすること。

## 失効予告 (`expiry-notice`)

失効の `EXPIRY_NOTICE_DAYS_BEFORE` 日前 (既定7日) になったロットについて、本人宛の
お知らせ (`Notice.ove_account_id` を設定した個別通知、重要度 `IMPORTANT`) を作成する。
失効させる `credit-expiry` とは別ジョブにしている (予告は失効の数日前に出す必要があり、
失効当日に走る処理とはタイミングが異なるため)。

- **重複防止**: 通知したロットに `ove_credit_lots.expiry_notice_sent_at` を立てる。
  毎日実行されるが、印の付いたロットは次回以降の対象から外れるため再通知されない。
  通知の作成と印付けは同一トランザクションで行う。
- **まとめ方**: 同じアカウントで複数ロットが対象になった場合は1通にまとめ、合計額と
  最短の失効日 (JSTの暦日) を載せる。
- **対象外**: 退会済み(`CLOSED`)アカウント、失効済み・取消済み・残高0のロット、
  既に失効日を過ぎたロット (予告としては手遅れで、次の失効バッチで処理される)。
- **1回の上限**: 500アカウント。超過分は未通知のまま残るため翌日の実行で拾われる。
- **LINE配信はしない**。`LineBroadcastService` は全ユーザーへの一斉配信で、本人宛の
  金額を全員に配信してしまうため。個別配信の口ができたら別途対応する。

個別通知はアプリの `GET /api/v1/me/notices` に本人だけ表示される。管理画面のお知らせ
一覧には**含めない** (利用者数に比例して増え、管理者が作った全員向けお知らせが埋もれ
るため)。

## 月末ポイント負債スナップショット (`liability-snapshot`)

前月末のポイント負債残高を `point_liability_snapshots` に記録する
(`docs/point-liability.md` 参照)。会計が期首残高を全期間の取引を遡らずに出せるように
するためのもの。

- 記録する値は**実行時刻に依存しない** (集計時点の実残高から月末以降の増減を差し引いて
  求める)。ジョブが遅れて走っても、後から手動で実行しても同じ値になる。
- **一度記録した月は上書きしない**。会計は締めた値が変わらないことを前提にするため。
  取り直したい場合は該当行を削除してから再実行する (通常は不要)。
- ジョブが何度か失敗して月をまたいだ場合、その月のスナップショットは欠けたままになる。
  管理画面の増減表でその月の期首残高が `-` になるので気づける。後から
  `captureMonthEndSnapshot("YYYY-MM")` を実行すれば正しい値で埋められる。

## 異常時の挙動

- **ジョブが失敗した場合**: エラーログを出して Sentry へ送り (`SENTRY_DSN` 未設定時は
  no-op)、プロセスは落とさない。次回のスケジュールで再実行される。
- **cron式が不正な場合**: そのジョブだけ登録に失敗し、エラーログと Sentry 通知を出す。
  他のジョブは通常どおり登録される (設定ミス1つでAPI全体が起動不能になるのを避けるため)。
- **Outboxが滞留している場合**: 1回の実行で最大10バッチ (既定20件/バッチ = 200件) まで
  処理する。それ以上は次回に持ち越す。送信に失敗したイベントは指数バックオフで
  `available_at` が先送りされ、8回で `FAILED` (Dead Letter) になり Sentry 通知が出る。
  `FAILED` は自動では再送されないため、管理画面「外部連携キュー」から手動再送する。

## 関連ドキュメント

- `docs/credit-expiry.md` — ORI有効期限・失効の仕様
- `docs/integration-outbox.md` — Transactional Outbox
- `docs/ledger-rules.md` — 整合性チェックの考え方
- `docs/monitoring.md` — Sentry・ログ収集
