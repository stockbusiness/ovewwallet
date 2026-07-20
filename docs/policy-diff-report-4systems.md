# 千ノ国4システム方針書 v2.1 と 千ノ国ウォレット現行実装の差分レポート

対象文書: 「千ノ国 4システム共通認識・連携方針書【完全版】v2.1」
（代理店システム／千ノ国パスポート／ショッピングシステム／千ノ国ウォレットの4システム共通の上位方針書）

> 本レポートは差分・影響範囲・必要API・データ移行の有無の報告のみを目的とする。
> 本書の内容に基づくコード改修は一切行っていない。各システムの具体的な実装範囲は、
> 本レポートの確認後に個別指示書で確定する想定。

---

## 1. 共通ユーザーID／共通顧客HUB（方針書 §3.1, §7, §26.1〜26.3, §27）

### 差分

- 方針書は「代理店システム内の共通顧客HUB」が `common_user_id` を発行・管理し、
  全システムがそれを保持する構造（`system_account_links` テーブル: common_user_id /
  system_name / local_account_id / link_status / linked_at）。
- 現行ウォレットには **`WalletReferral.commonUserId`** フィールドが既にスキーマ上存在するが、
  コメント「将来 `ENABLE_PLATFORM_USER_ID` が有効になった場合の共通ID。Phase 1では未設定」の
  通り常時 `null`。HUBへの照会・発行APIは呼んでいない。
- 現行の `AccountLink`（`ove_account_id` / `service_integration_id` / `external_user_id` /
  `status: PENDING|ACTIVE|REVOKED`）は、方針書の `system_account_links`（`common_user_id` /
  `system_name` / `link_status`）と**構造は酷似**しているが、キーがHUB発行の
  `common_user_id` ではなく**ウォレット自身が発行する `OveAccount.id`** を主語にしている点が
  根本的に異なる（ウォレットが正本、HUBは未登場）。
- `AccountIdentity`（provider/providerSubject単位の識別情報）は方針書 §26.2
  `user_identities`（identity_type/identity_value/common_user_id）とほぼ1:1対応するが、
  こちらも `common_user_id` ではなく `oveAccountId` に紐づく。

### 影響範囲

- `OveAccount` を「正本」として扱ってきた設計思想全体（アカウント統合・SSO・紐付け系のコード
  一式：`AccountService`, `AccountLink` 関連, 管理画面 `/agency-links`・`/service-integrations`）
  が、HUB発行の `common_user_id` を主語とする設計に置き換わるか、追記的に対応させるかの判断が
  必要。
- 既存の「アカウント統合(マージ)」機能（`OveAccount.mergedIntoAccountId`）は方針書 §26.5
  `account_merge_logs`（source/destination common_user_id）と概念は同じだが、統合の起点が
  HUB側かウォレット側かで権限モデルが変わる。

### 必要API（案）

- ウォレット→HUB: `POST /users/resolve`（既存アカウント照会）, `POST /users`（新規発行依頼）,
  `POST /users/{common_user_id}/accounts/link`（ウォレット側account_link確定の通知）は方針書
  のみに存在し、現行ウォレットには対応する送信先も受信口も無い。
- 現行の `POST /api/v1/auth/sso/agency`（代理店SSO受信）は方向としては方針書の
  `agent.assigned` 受信に近いが、`common_user_id` を受け取る前提になっていない。

### データ移行の有無

**要**。既存 `OveAccount` 全件に対して `common_user_id` を新規発行するか、HUB側の既存IDと
突き合わせるマッピング作業が発生する（方針書§35.2「各システムIDの対応表を作成」に該当）。
件数規模次第だが、既存ウォレット利用者は移行前提でゼロではない。

---

## 2. 登録経路・代理店関係のユーザー区分（方針書 §8〜§13, §26.1, §31）

### 差分

- 方針書は5種の代理店関係IDを区別: `registration_referrer_agent_id`（登録紹介者）／
  `assigned_agent_id`（現担当代理店）／`order_sales_agent_id`／`order_closer_agent_id`
  （注文ごとの販売・クロージング担当）／`agent_touchpoint`（接触履歴）。
- 現行ウォレットの `WalletReferral` は**登録紹介者1種類のみ**（`agencyId` は
  「代理店システムに確認済みの紹介元」という単一目的で、モデルコメントにも明記の通り
  「代理店のランク・階層情報自体はウォレット側で永続管理しない」）。`assigned_agent_id`・
  注文別の販売/クロージング担当・接触履歴（`agent_touchpoints`）に相当する概念はウォレット側に
  存在しない。
- `acquisition_channel`（game/agent_referral等の登録経路）、`agent_link_status`
  （none/pending/linked/disputed/released の5値）は現行スキーマに存在しない。現行の
  `WalletReferralStatus`（CAPTURED/PENDING/CONFIRMED/REJECTED/MANUALLY_CONFIRMED/
  CANCELLED/ERROR/EXPIRED）は「紹介トークンの処理状態」であり、方針書の `agent_link_status`
  （アカウントと代理店の関係状態そのもの）とは軸が異なる。
- ただし方針書§31「代理店帰属を保護するルール」（Cookie上書き禁止・登録紹介者と販売担当の
  混同禁止・先行登録は仮顧客扱い等）は、現行 `docs/agency-referral.md` の設計（紹介Cookie
  使い切り・既存ユーザーへの上書き防止・PENDING確定は代理店確認待ち）と**思想面ではすでに
  整合**している。

### 影響範囲

- 5種の関係IDのうち「注文ごとの販売・クロージング担当」はショッピングシステム側の概念であり、
  ウォレット側で持つ必要はなさそう（方針書§5.4「管理しない情報」に代理店報酬・購入権利の
  正本は含まれない）。ウォレットが保持すべきは登録紹介者（既存）＋必要ならHUBから参照する
  `agent_link_status` の表示程度。
- 現行 `docs/agency-referral-decisions.md` に未回答のまま残っている②〜⑥の判断事項
  （トークン事前確認方式、紹介なし登録者の制限有無、不正取得対策、着地ページ等）は、方針書の
  「HUB照会」フローが導入されるとA/B案の前提自体が変わる可能性がある（要再確認）。

### 必要API

- 現行の `GET /api/v1/referrals/capture` は方針書の `POST /referrals/capture` に近いが、
  確認（confirm）は現状「代理店システムからの結果反映」が Phase 2 未実装のまま。方針書の
  `POST /referrals/confirm` はこの未実装分をHUB経由の標準APIとして定義しているとみなせる。
- `POST /agents/assign` / `GET /users/{common_user_id}/sales-context` はウォレットに現状
  存在せず、HUB側APIとして新設される想定（ウォレットからの呼び出しが必要かはPhase 3の
  `sales_model`次第）。

### データ移行の有無

**要検討**。既存 `WalletReferral` 行を `agent_link_status`（linked/none等）へどうマッピング
するかは、方針書のenum定義とプロダクトとして1対1にならない可能性がある（現行は「紹介トークン
処理」の状態機械であり「代理店との関係状態」ではない）。既存の代理店紐付き利用者データを
損なわない形での変換ルールが個別指示書で必要。

---

## 3. 商品販売方式 sales_model（方針書 §5.3, §15, §18）

### 差分

方針書の「ショッピングシステム」自体が、現行4システム構成（ウォレット・パスポート・代理店・
AIART等）には**存在しない新規システム**。`sales_model`（direct_allowed/agent_required/
hybrid）は商品単位の属性であり、そもそも商品・注文を扱う概念が現行ウォレットにはない
（ウォレットは「管理しない情報」として明示的に商品注文・購入権利の正本を除外している＝方針書
と現行実装は元々整合）。

### 影響範囲

ウォレット側の直接改修は基本的に発生しない想定。ただし「購入特典としてのOVE/ポイント/
クーポン付与」の**受け口**（entitlement.granted相当のイベント受信）は新設が必要になる。

### 必要API

`POST /entitlements/grant` はパスポート・ウォレット双方が受信対象（方針書§18 手順13
「ウォレットへ特典付与を依頼」）。現行の外部連携報酬付与口は `POST /api/v1/rewards/grant`
（HMAC認証・`service_code`/`external_user_id`/`event_id`/`idempotency_key`）のみで、これが
将来の「ショッピングシステム」からの特典付与にも転用できるか、新設の
`ServiceCode.SHOPPING_SYSTEM`＋別スキーマが必要かは要判断。

### データ移行の有無

無し（新規システムのため、既存データの変換対象がそもそも存在しない）。

---

## 4. ウォレット台帳・外部API（方針書 §5.4, §19.4, §27）

### 差分

- 方針書の論理API `POST /wallet/credits` / `POST /wallet/debits` に対し、現行実装は
  `POST /api/v1/rewards/grant`（付与）／`POST /api/v1/transactions/debit`（利用）／
  `POST /api/v1/transactions/{id}/reverse`（取消）の3本立て。命名は異なるが機能的には
  ほぼ1:1対応（grant≒credits、debit≒debits、reverse相当は方針書側に明示のエンドポイントなし
  ＝entitlement.revoked/wallet debit逆操作で代替する設計と推測される）。
- 現行リクエストは `service_code` + `external_user_id`（ServiceIntegration単位の外部ID
  解決）を主キーにしており、`common_user_id` フィールドは存在しない。方針書のイベント共通
  項目（§28.1）は `common_user_id` を必須項目として持つ。
- 台帳原則（残高を直接上書きせず取引履歴から算出、付与/使用/取消/調整）は現行
  `packages/ledger` の CREDIT/DEBIT/REVERSAL/HOLD/RELEASE 設計と**完全に整合**しており、
  この点の改修は不要と判断できる。

### 影響範囲

- API自体の破壊的変更（エンドポイント名変更）は不要と考えられるが、**リクエストスキーマに
  `common_user_id` を追加するかどうか**は要判断（現状 `external_user_id` のみで解決できて
  いるため、必須にするなら `RewardGrantRequestSchema`/`DebitRequestSchema` の変更が必要）。
- `service_code` の外部システム識別（`ServiceCode` enum）に将来 `SHOPPING_SYSTEM` を
  追加する必要がある可能性。

### 必要API

新設ではなく既存APIへの**フィールド拡張**で対応できる可能性が高い。ただし「ショッピング
システム」からの直接呼び出しか、HUB経由の呼び出しかで認証方式（既存の
`ExternalApiAuthGuard`のHMAC認証を使うか、`AgencyApiKeyGuard`相当の簡易鍵認証にするか）が
変わる。

### データ移行の有無

無し（台帳データ自体の構造・過去取引を書き換える必要はない）。

---

## 5. イベント／Webhook連携（方針書 §28, §29）

### 差分

- 方針書は `user.created/linked/merged`、`referral.captured/confirmed`、
  `agent.assigned/released`、`order.*`、`entitlement.granted/revoked`、
  `wallet.credit.requested/completed`、`wallet.debit.requested/completed`、`commission.*`
  という**体系立てたイベントカタログ**＋共通項目（event_id/event_type/schema_version/
  occurred_at/source_system/common_user_id/correlation_id/idempotency_key/payload/
  signature）を定義。
- 現行ウォレットには `integration_outbox`（Transactional Outbox）が既に実装されており、
  `wallet.referral.registered` イベントの送信実績がある。冪等性・再送の仕組み（既存Feature
  Flag基盤）は方針書§29.1〜29.2の思想と整合的。ただし現行outboxイベントに
  `schema_version` / `correlation_id` / `common_user_id` といった方針書指定の共通項目が
  揃っているかは要確認（未確認、要コード調査）。
- `wallet.credit.requested`→`wallet.credit.completed` のような**リクエスト/完了の2段階
  イベント**は現行実装に無い（現行は同期HTTPレスポンスのみで、非同期イベント発行はしていない）。

### 影響範囲

- outbox発行イベントのpayloadスキーマ統一（共通項目の追加）が必要になる可能性。
- 既存の「outbox自動再送は未実装、現状`/admin/outbox`からの手動dispatchのみ」という制約
  （`docs/agency-referral.md`記載）は、方針書§29.2の「自動再送」原則と差分がある。

### 必要API

Webhook受信口（他システムからの`order.paid`/`order.refunded`等の受信）は現行ウォレットに
**一切存在しない**（現行は「代理店システムからの同期受信」`POST /api/integrations/agencies`
のみで、注文・返金系のWebhook受信口は無い）。新設が必要。

### データ移行の有無

無し（今後発生するイベントの形式の問題であり、既存データの移行対象ではない）。

---

## 6. 返金・キャンセル・チャージバック連動（方針書 §22）

### 差分

- 方針書は「返金の起点はショッピングシステム」とし、`order.refunded`等の通知を受けて
  ウォレットが「対象特典を取消（無効化、物理削除しない）」と明記。
- 現行ウォレットの取消手段は `POST /api/v1/transactions/{transactionId}/reverse`（外部
  サービスからの明示的リクエスト）と、管理画面からの手動`REVERSAL`のみ。**自動的な返金
  イベント受信→特典取消**のフローは存在しない。
- 既存の `WalletReferralBenefit.status = REVOKED` という「一度付与した特典を後から取消す」
  状態は既にあるが、これは紹介特典専用であり、汎用的な「購入特典の返金連動取消」の仕組み
  ではない。

### 影響範囲

ショッピングシステムからの `refund_id`/`order_id`/`order_item_id`/`refund_type`/
`refund_amount`/`reason` を受けてウォレット側で該当取引を検索し `reverse` する連携処理の
新設が必要。既存`reverseTransaction()`のリクエスト主体（現状は`service_code`+
`transactionId`直接指定）が、返金イベント経由の間接的な取消要求にも対応できるか要確認。

### 必要API

Webhook受信: `order.refunded` / `order.partially_refunded` / `order.chargeback` の
受信口が新設対象（前項と同じ）。

### データ移行の有無

無し。

---

## 7. クーポン仮押さえ（方針書 §21）

### 差分

方針書はウォレットが「クーポンの保有者・有効期限・使用状態・**仮押さえ状態**・国限定/共通
区分」を管理する前提で書かれているが、現行スキーマにはクーポン関連モデル自体が見当たらない
（`WalletReferralBenefit`等の特典系はあるが「クーポン」概念は未実装）。

### 影響範囲

クーポン機能自体が現行ウォレットにゼロから必要になる可能性がある。要現状再確認。

### 必要API

ショップ→ウォレット: 利用可否確認・仮押さえ・使用確定・仮押さえ解除の4APIが新設対象。

### データ移行の有無

無し（新規機能のため）。

---

## 8. 既存データ移行方針（方針書 §35）全体との整合

### 差分

- 方針書の移行手順（バックアップ→ID対応表作成→完全一致する外部認証IDの自動紐づけ→氏名
  のみ一致は自動統合しない→競合は管理者確認→ドライラン→ロールバック手順）は、現行実装済み
  の「既存ユーザー移行の実行機能」「既存ユーザー移行の検証者フロー」「アカウント統合(マージ)
  機能」と**手続き面ではかなり近い**（過去タスクで同種の思想を既に実装済み）。
- 差分は主キーが `OveAccount.id` から `common_user_id` に変わる点、および「代理店システム内
  HUB」という**外部システムを正本とする**点。既存移行機能はウォレット内で完結する設計だった
  ため、HUBとの突合処理（外部API呼び出しを伴うバッチ）が新規に必要。

### データ移行の有無

**要**。総括すると次の3点が確実に移行対象になる。

1. 全 `OveAccount` への `common_user_id` 付与（HUB新規発行 or 既存ID突合）
2. `AccountLink` / `AccountIdentity` の一部フィールドを `system_account_links` /
   `user_identities` 形式に合わせるか、マッピング層を新設
3. `WalletReferral` の代理店関連フィールド（`agencyId`, `commonUserId`, `status`）を
   `agent_link_status` 等の新概念に変換するルール策定

---

## まとめ（サマリ表）

| 領域 | 差分の大きさ | 実装済み土台 | 必要API(新設/拡張) | データ移行 |
|---|---|---|---|---|
| 共通ID/HUB | 大 | `commonUserId`が既に存在(未使用) | HUB照会/発行/link通知 (新設) | 要 |
| 代理店関係区分(5種) | 中〜大 | 登録紹介者のみ実装済み | confirm/assign/sales-context (新設) | 要(変換ルール要策定) |
| sales_model/ショップ連携 | 大(新システム) | 「管理しない」と明記済みで無矛盾 | entitlements.grant受信 (新設) | 無 |
| ウォレット台帳API | 小 | grant/debit/reverseで機能的に充足 | 既存API拡張のみで対応可能性大 | 無 |
| イベント/Webhook | 中 | outbox基盤は既存 | 注文/返金系の受信口 (新設) | 無 |
| 返金連動取消 | 中 | reverse機能はあるが自動連携なし | refund Webhook受信 (新設) | 無 |
| クーポン | 大(未実装機能) | 無し | 4API新設 | 無 |
| 既存データ移行手続き | 小(手法は流用可) | 移行/統合機能が既存 | HUB突合バッチ (新設) | 要 |

---

以上が調査結果である。本レポート作成にあたり、コード改修は一切行っていない。各領域の実装
範囲・優先順位は、この差分確認を踏まえた個別指示書の提示を待って確定する。
