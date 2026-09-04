# 代理店紹介とORI付与の連携仕様 (ウォレット側)

代理店システム (sengoku-ai.com) からの依頼「ORLYウォレット側 実装依頼」に対する、
ウォレット側の実装内容と、連携先へ渡す情報をまとめる。

対応する画面・コードは以下。

| 範囲 | 実装 |
|---|---|
| 紹介URLの受け取り | `apps/user-wallet/src/app/invite/route.ts`, `apps/user-wallet/src/middleware.ts`, `apps/api/src/referrals/referrals.controller.ts` |
| 登録完了通知の送信 | `apps/api/src/integrations/agency-referral.adapter.ts` |
| 付与イベントの受信 | `apps/api/src/common-events/agency-point-award.controller.ts`, `apps/api/src/common-events/handlers/point-award-wallet-delivery.handler.ts` |

## 用語

依頼文書の「コーリーコイン」は、**このウォレットが管理する残高 (画面表示は ORI)** として
実装している。ウォレットの台帳は1種類しかなく、`point_code` が `orly` / `ori` / `ove` の
いずれか (または未指定) の付与を ORI 残高への加算として扱う。**別種類の通貨を新設する
指示であった場合は、この前提が違う**ため連携前に指摘してほしい。

---

## 1. 紹介URLから受け取るパラメータ

連携先へ渡す紹介URLは次の形にする。

```
https://sennokuni-wallet.com/invite?referral_token=...&referral_session_key=...&agency_id=...&source=sengoku-agency
```

- `referral_token` は `rt`、`referral_session_key` は `rs` でも受け付ける。
- 既存のパス形式 `https://sennokuni-wallet.com/invite/{token}` も従来どおり動く。
- `/invite` 以外 (トップや `/login`) に `referral_token` / `rt` が付いた場合も、
  同じクエリのまま `/invite` へ寄せる (`apps/user-wallet/src/middleware.ts`)。
  連携先が登録URLをどう組み立てても紹介が失われないようにするため。

受け取った値は `wallet_referrals` に保存する。

| URLのパラメータ | 保存先 | 備考 |
|---|---|---|
| `referral_token` / `rt` | `referral_token_encrypted` (可逆暗号) と `referral_token_hash` | 生値はログに出さない |
| `referral_session_key` / `rs` | `referral_session_key` | 指定時は `canonical_referral_token` にも `referral_token` を入れる |
| `agency_id` | `agency_id` | |
| `source` | `source` | 未指定なら `invite_url` |

`referral_session_key` がURLで渡ってきた場合、代理店システムへの
`POST /api/referrals/capture` は呼ばない。連携先が既に紹介セッションを作り終えている
ためで、この経路は `ENABLE_AGENCY_REFERRAL_SYNC` が無効でも動く。

`referral_token` 以外のパラメータは `^[A-Za-z0-9._~-]{1,255}$` に一致しないものを捨てる。
URLは利用者が自由に書き換えられる入力のため、想定外の値はDBにもログにも残さない。

紹介Cookieの有効期限は既定24時間 (`REFERRAL_SESSION_TTL_HOURS`)。

---

## 2. 新規登録完了時の通知

登録完了後、ウォレットから代理店システムへ送る。

```
POST https://sengoku-ai.com/api/referrals/confirm
```

送信する本文は、**依頼文書の項目名と、共通実装契約5章の項目名の両方**を含む。
同じ値を2つの名前で送るだけなので、連携先がどちらの版を実装していても受け取れる。

```json
{
  "referral_token": "rt_xxx",
  "canonical_referral_token": "rt_xxx",
  "referral_session_key": "rs_xxx",
  "source_system_key": "orly-wallet",
  "system_key": "orly-wallet",
  "source_user_id": "<ORIアカウントID>",
  "external_user_id": "<ORIアカウントID>",
  "common_user_id": "cu_xxx",
  "event_type": "wallet.registration.completed",
  "occurred_at": "2026-09-02T01:00:00.000Z"
}
```

- `common_user_id` は未解決のときキーごと送らない (`null` を送らない)。
- `occurred_at` は**登録が完了した時刻**。再送しても値が変わらない。
- **`wallet_address` は送らない。** このウォレットはORIの台帳残高であって、
  利用者に発行されるブロックチェーンアドレスを持たないため
  (`BlockchainMigration` は将来のためのデータ構造のみ)。

### `source_system_key` の値について

`orly-wallet` は固定値ではなく、管理画面の **設定 > 共通顧客HUB連携** で設定した
`system_key` をそのまま送っている (未設定時の既定は `ove-wallet`)。
**連携前に `orly-wallet` へ設定し、代理店システム側の登録値と一致させること。**

送信は `ENABLE_AGENCY_REFERRAL_SYNC` が有効なときだけ行われる。失敗しても利用者の
ログインは止めず、Outbox (`wallet.referral.registered`) が指数バックオフで再送する。

---

## 3-4. 付与イベントの受信

```
POST https://api.sennokuni-wallet.com/api/integrations/agencies/point-awards
```

依頼文書のイベント本文をそのまま受け付ける (`orly.point_award.wallet_delivery`)。

### 付与先の決め方

`point_award.recipient_common_user_id` → `point_award.recipient_agent_id` の順に解決する。
共通顧客IDを先に見るのは、こちらが千ノ国全体で一意な識別子で、`recipient_agent_id` は
代理店システム内でのみ一意な値だからである。

`recipient_agent_id` は `account_links` (`AGENCY_SYSTEM` の `external_user_id`) から引く。
数値・文字列どちらで送られても照合できる。

| 状況 | 応答 | 送信側の扱い |
|---|---|---|
| 解決できた | 200/201 | 付与済み |
| どちらの指定も無い | 400 | 本文の誤り。再送しても直らない |
| 担当者がまだウォレットへログインしていない | 404 | **再送してよい**。ログイン後に成功する |
| 連携が解除済み (`account_links` が REVOKED) | 404 | 同上 |
| 共通顧客IDが複数アカウントに紐づく | 400 | 要レビュー。誤付与を避けるため付与しない |

### ポイント数

`point_award.points` は正の整数のみ。小数・0・負数は**丸めずに 400** で拒否する
(暗黙の丸めは残高の食い違いを生むため)。

### 台帳への記録

`ove_transactions` に `transaction_type=COMMON_EVENT_REWARD` の CREDIT として記録し、
`metadata` に `awardEventKey` / `campaignId` / `recipientType` / `triggerEventId` /
`directReferrerAgentId` / `upperDirectorAgentId` などの由来を残す。

管理画面の **付与ルール** で `AGENCY_POINT_AWARD:orly` というルールコードを登録すれば、
1回あたり・1人あたり・月次・累計の上限を掛けられる。ルール未登録なら上限なしで通る。

---

## 5. 認証

`Authorization: Bearer {api_key}` と `x-api-key: {api_key}` の**どちらでもよい**。
キーは `service_integrations` の `AGENCY_SYSTEM` 行のもので、管理画面の
**外部サービス管理 > APIキー再発行** から発行・再発行できる
(`docs/runbooks/service-integration-key-lifecycle.md`)。

`Idempotency-Key` / `X-Correlation-Id` は任意。`Idempotency-Key` を送る場合は
`event_id` と同じ値にすること (食い違う場合は 400)。

HMAC (`X-SenNoKuni-*`) は**このエンドポイントでは不要**。署名付きで送りたい場合は
既存の共通イベントInbox `POST /api/integrations/events` が使える (そちらは署名必須)。
どちらの経路から届いても、台帳の冪等キーが二重付与を防ぐ。

---

## 6. 冪等性

二重付与の防止は2段構え。

1. `inbound_events` の `source_system_key + event_id`。同じイベントの再送は台帳に触れず、
   前回の結果をそのまま返す (`cached: true`)。
2. 台帳の `idempotency_key` = `AGENCY_POINT_AWARD:{award_event_key}`。
   `event_id` だけ振り直して同じ付与が再送された場合はこちらが受け止める。

どちらの経路でも、2回目以降は**同じ `wallet_event_id`** を返す。

同じ `event_id` で**本文が違う**ものが届いた場合は、処理せず 409 を返す
(どちらが正しいか判断できないため)。

---

## 応答形式

成功:

```json
{
  "ok": true,
  "event_id": "orly_wallet_123",
  "wallet_event_id": "<ORI取引ID>",
  "status": "credited",
  "cached": false
}
```

`cached` が `true` のときは再送で、台帳には触れていない。付与状態を `delivered` へ
進めてよい点は初回と同じ。

失敗:

```json
{
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "..." },
  "request_id": "..."
}
```

| HTTP | `error.code` | 意味 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 本文の誤り。再送しても直らない |
| 401 | `API_KEY_REQUIRED` / `INVALID_API_KEY` | 認証ヘッダー無し / キー不一致 |
| 404 | `NOT_FOUND` | 付与先が未解決。**再送してよい** |
| 409 | `COMMON_USER_ACCOUNT_CONFLICT` | 同じ `event_id` で本文が違う |
| 503 | `FEATURE_DISABLED` | `ENABLE_AGENCY_POINT_AWARD_INBOX` が未有効 |

---

## 7. 接続テストの順序

1. 代理店URLからウォレットの登録画面へ遷移できる → `/invite?referral_token=...`
2. ウォレット側で `referral_token` を保持できる → `wallet_referrals` に CAPTURED が1件
3. 登録完了時に `POST /api/referrals/confirm` を送信できる →
   `ENABLE_AGENCY_REFERRAL_SYNC=true` が必要
4-5. (代理店システム側)
6. 付与イベントが届く → `ENABLE_AGENCY_POINT_AWARD_INBOX=true` が必要
7. 二重付与せず加算される → 同じ `event_id` をもう一度送って `cached: true` を確認
8. `wallet_event_id` が返る
9. (代理店システム側)

## 有効化に必要な環境変数

| 変数 | 用途 | 本番 (2026-09-04) |
|---|---|---|
| `ENABLE_PLATFORM_USER_ID` | 共通顧客HUB経由の `common_user_id` 解決 | ✅ |
| `ENABLE_WALLET_REFERRAL_TOKEN` | 紹介URLの受け付け | ✅ |
| `ENABLE_AGENCY_REFERRAL_SYNC` | 代理店システムへの capture/confirm 送信 | ✅ |
| `ENABLE_AGENCY_LOGIN` | 代理店SSOログイン (`/sso/agency`) | ✅ |
| `ENABLE_AGENCY_POINT_AWARD_INBOX` | 付与イベントの受信 | 本PRで有効化 |

いずれもコード上の既定は false。`.github/workflows/deploy.yml` が本番の値を持つ。

`ENABLE_PLATFORM_USER_ID` は**紹介確定の前提**である。`common_user_id` が未解決だと
確定のOutboxハンドラが例外を投げて再送し続けるため
(`apps/api/src/referrals/agency-referral-outbox-handler.ts`)、
`ENABLE_AGENCY_REFERRAL_SYNC` だけを開けても紹介は確定しない。

`ENABLE_AGENCY_LOGIN` は**付与の前提**である。付与先が `recipient_agent_id` で
指定された場合、その代理店がSSOでログインして `account_links` が ACTIVE に
なっていないと受取人を解決できず404になる (3-4章)。

`ENABLE_AGENCY_POINT_AWARD_INBOX` が false の間は 503 を返し、`inbound_events` に
行を作らない (行を作ると、後から有効化しても同じ `event_id` が二度と処理されなく
なるため)。有効化するときは、**金額上限が入っていること**を先に確認すること
(受信しただけでORI残高が増える経路のため。上限は3-4章「金額の上限」)。

---

## 8. 連携先へ渡す情報

| 項目 | 値 |
|---|---|
| ウォレット登録URL | `https://sennokuni-wallet.com/invite` |
| 付与イベント受信エンドポイント | `https://api.sennokuni-wallet.com/api/integrations/agencies/point-awards` |
| 受信用APIキー | 管理画面 **外部サービス管理 > AGENCY_SYSTEM > APIキー再発行** で発行した値 (再発行時に1度だけ表示される) |
| 認証方式 | `Authorization: Bearer {api_key}` または `x-api-key: {api_key}`。HMACは不要 |
| 成功レスポンス形式 | 上記「応答形式」参照 (`ok` / `event_id` / `wallet_event_id` / `status` / `cached`) |
| エラーレスポンス形式 | 同上 (`ok:false` / `error.code` / `error.message` / `request_id`) |
| 登録完了通知の送信元 | `source_system_key` = 管理画面で設定した `system_key` (`orly-wallet` に設定すること) |

テスト用ユーザーID・ウォレットアドレスについて:

- **ウォレットアドレスは存在しない** (1章・2章参照)。
- テスト用ユーザーIDは、検証環境で実際にLINEログインしたアカウントの
  ORIアカウントID (`ove_accounts.id`) を管理画面の **ウォレット一覧** から控えて渡す。
  固定のテストIDは用意していない (本番と検証でDBが別のため)。
