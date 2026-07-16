# Transactional Outbox と Feature Flag (開発ガイドライン10章・13章)

代理店システムなど外部サービスとの連携を見据えた「素地インフラ」として実装したもの。
代理店システム側の仕様・契約に依存しない、汎用的な基盤部分のみを対象としており、
紹介情報の受け入れ (`ref_token`/`referral_session`) や実際の代理店システムとの通信は
含まれない (ガイドライン19章の指示により、それらは仕様確定後に改めて現状調査してから着手する)。

## Transactional Outbox

外部サービスへの通知は「自分側の業務データ更新」と「相手への通知」が別トランザクション・
別プロセスになるため、通知の送信漏れ・重複送信が起こりうる。これを避けるため、
通知したいイベントをまず自分のDB (`integration_outbox` テーブル) に業務データ更新と
同一トランザクションで書き込み、実際の送信は後続の非同期処理に任せる
(at-least-once配信 + 冪等キーでの重複排除)。

### テーブル: `integration_outbox`

| カラム | 内容 |
|---|---|
| `event_type` | イベント種別 (例: `REFERRAL_SYNC_REQUESTED`) |
| `aggregate_type` / `aggregate_id` | イベントの対象 (例: `referral_session` / そのID) |
| `destination_service` | 送信先 (例: `AGENCY_SYSTEM`)。宛先ごとに`OutboxDestinationHandler`を登録する |
| `payload` | 送信内容 (JSON) |
| `idempotency_key` | 一意制約。同じキーでの`enqueue()`は二重登録されない |
| `status` | `PENDING` → (`PROCESSING`) → `SENT` または `FAILED` |
| `attempt_count` | 試行回数。最大8回で`FAILED`に遷移 |
| `available_at` | 次回再送予定時刻 (指数バックオフ: 30秒起点、最大6時間) |
| `last_error_code` / `last_error_message` | 直近の失敗内容 (手動再送の判断材料) |

### `OutboxService` (`apps/api/src/outbox/outbox.service.ts`)

- `enqueue(tx, params)`: 業務データ更新と同じPrismaトランザクション内から呼び出す想定。
  `idempotencyKey`が既存であれば新規作成せずそのまま返す (冪等)。
- `registerDestination(name, handler)`: 宛先ごとの送信処理を後から差し込む
  (LINE/戦国パスポートSSOをモック実装→本番実装に差し替えてきたのと同じパターン)。
  現時点では代理店システム向けの実ハンドラは未登録であり、キューに積んでも
  実際にはどこにも送信されない (土台のみ)。
- `processPendingEvents(limit)`: `available_at`が到来した`PENDING`イベントを
  条件付き`updateMany`で排他的に確保してから送信する (複数ワーカーでの二重処理防止)。
  失敗時は指数バックオフで`available_at`を先送りし、`attempt_count`が上限に達したら
  `FAILED`にする。将来的にはスケジューラ (cron等) から定期的に呼び出す想定だが、
  現時点では管理画面からの手動トリガーのみ。
- `manualRetry(id)`: `FAILED`のイベントを`attempt_count: 0`で`PENDING`に戻す
  (`last_error_message`等の履歴は監査目的で保持したまま)。

### 管理API・画面

- `GET /api/v1/admin/outbox` (`status`/`destinationService`で絞り込み)
- `POST /api/v1/admin/outbox/dispatch` (再送期日到来分をまとめて処理)
- `POST /api/v1/admin/outbox/:id/retry` (手動再送)
- 管理画面「外部連携キュー」(`apps/admin-wallet/src/app/outbox/page.tsx`) で一覧・
  絞り込み・手動再送・Feature Flag確認ができる。

## Feature Flag

外部連携機能を安全に段階導入するため、`process.env`ベースの単純なON/OFFフラグを用意した
(`apps/api/src/common/feature-flags.ts`)。DBには保存せず、環境変数のみを真実源とする
(`HIGH_VALUE_THRESHOLD`など既存の環境変数駆動の設定と同じ考え方)。

| フラグ | 用途 |
|---|---|
| `ENABLE_PLATFORM_USER_ID` | 共通プラットフォームユーザーIDの利用 (将来) |
| `ENABLE_WALLET_REFERRAL_TOKEN` | 紹介トークンの受け取り (将来) |
| `ENABLE_AGENCY_REFERRAL_SYNC` | 代理店システム(sengoku-ai.com)外部連携API (`POST /api/integrations/agencies`) の有効化。`docs/agency-integration.md`参照 |
| `ENABLE_AGENCY_SYNC_RETRY` | 代理店同期の自動再送 (将来) |
| `ENABLE_WALLET_REGISTRATION_BONUS` | 登録ボーナス連携 (将来) |
| `ENABLE_EXTERNAL_REWARD_TYPES` | 外部サービス起点の付与種別 (将来) |
| `ENABLE_ONCHAIN_MIGRATION` | オンチェーン移行 (将来) |

すべて既定で`false`。`ENABLE_AGENCY_REFERRAL_SYNC`以外は現時点でどのコードも
参照しておらず、OFFのままで既存のログイン・残高表示・取引履歴・管理画面が
壊れないことを自動テストで確認済み (`apps/api/src/e2e/outbox.test.ts` の
"Feature Flags" スイート)。`ENABLE_AGENCY_REFERRAL_SYNC`がOFFの場合、
`POST /api/integrations/agencies` は503を返す
(`apps/api/src/e2e/agency-integration.test.ts`)。
`GET /api/v1/admin/feature-flags` で現在値を確認できる (管理画面からの変更は不可)。

## 今後 (Phase 2以降)

- `referral_session`テーブルと紹介トークンの受け入れフロー。
- 代理店システム向けの実際の`OutboxDestinationHandler`実装 (HTTP送信・認証方式は
  代理店システム側の仕様確定後に決定)。
- `processPendingEvents()`を定期実行するスケジューラ (現状は管理画面からの手動トリガーのみ)。
- 上記フラグを実際に参照する分岐ロジックの実装。
