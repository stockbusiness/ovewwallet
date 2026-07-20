# 千ノ国5システム方針書 v3.0（AIアート教室統合版）と 千ノ国ウォレット現行実装の差分レポート

対象文書: 「千ノ国 5システム共通認識・連携方針書【完全版】v3.0 AIアート教室統合版」
（代理店システム／千ノ国パスポート／ショッピングシステム／千ノ国ウォレット／
**AIアート教室**の5システム共通の上位方針書。作成日2026年7月20日）

> 本レポートは差分・影響範囲・必要API・データ移行の有無の報告のみを目的とする。
> 本書の内容に基づくコード改修は一切行っていない。各システムの具体的な実装範囲は、
> 本レポートの確認後に個別指示書で確定する想定。
>
> 本書は `docs/policy-diff-report-4systems.md`（v2.1・4システム版に対する差分レポート）を
> **改訂・置き換え**するものである。v2.1時点の指摘（共通ID/HUB、登録経路・代理店関係区分、
> sales_model、ウォレット台帳API、イベント/Webhook、返金連動、クーポン、既存データ移行）は
> v3.0でも構造上ほぼ変更がないため要旨のみ再掲し、**v3.0で新規追加された「AIアート教室」
> 関連の差分**を中心に詳述する。

---

## 1. v2.1からの変更点の全体像

v3.0での主な変更は以下の1点に集約される。

- 対象システムが4→5に増え、**AIアート教室**が新システムとして追加された
  （§2.4, §5.5, §13.5, §19.5, §26.6, §33「AIアート教室管理」, §36 各Phase, §39, 付録A-6〜A-8,
  付録B「AIアート教室」節などに新規記述）。
- それに伴い、共通ID周りの構造にも `ai_art_member_id` が追加された
  （§7.1, §25, §26.6）。他の項目（`common_user_id`, `agent_link_status`,
  `acquisition_channel`, `sales_model` 等）の定義自体はv2.1から変更なし。
- 開発担当者の共通ルール（旧§38に相当）にAIアート教室固有の項目（決済確定後の受講権有効化、
  出席の二重付与防止、教室参加者の代理店帰属自動化禁止）が3項目追加された（新§38の26〜28）。

v2.1で指摘した既存ウォレット実装との差分（共通顧客HUB未接続、`agent_link_status`等の
未実装、entitlement/refund系Webhook受信口の不在、クーポン機能の不在等）は、v3.0でも**その
まま有効**である。詳細は本書末尾「2〜9章」を参照。今回新たに判明した最重要ポイントは
**AIアート教室が既にウォレットと連携済み（`ServiceCode.AIART`）だが、v3.0が要求する
ドメインモデルとは全く異なる簡易実装のまま**という点である。

---

## 2. AIアート教室（新規・v3.0で追加）— 方針書 §2.4, §5.5, §13.5, §19.5, §26.6, §36, §38

### 差分

- 方針書はAIアート教室を「予約」「出欠」「講座・学習進捗」「作品制作」「展示申請」まで含む
  独立ドメインとして定義し、以下の専用テーブルを推奨する（§26.6）。
  - `ai_art_members`（ai_art_member_id, common_user_id, member_status, plan_status）
  - `ai_art_bookings`（ai_art_booking_id, common_user_id, ai_art_class_id, booking_status,
    booked_at, cancelled_at）
  - `ai_art_attendances`（attendance_id, ai_art_booking_id, common_user_id,
    attendance_status, completed_at）
  - `ai_art_course_access`（access_id, common_user_id, ai_art_course_id, source_order_id,
    access_status, granted_at, revoked_at）
  - `ai_art_artworks`（artwork_id, common_user_id, ai_art_course_id, created_at,
    publication_status, exhibition_status, external_service_status）
- 現行ウォレット実装の実態（調査確認済み）:
  - `ServiceCode` enumに `AIART` が1値として存在するのみで、専用コメントや特別扱いは無い
    （`SENGOKU_GACHA`, `NFT_MARKET`等と完全に同列の汎用外部サービスの一つ）。
  - `TransactionType` enumに `AIART_ATTENDANCE` が存在し、
    `RULE_CODE_BY_TRANSACTION_TYPE` マッピングで `AIART_ATTENDANCE_REWARD` という付与ルール
    コードに対応づけられている（`apps/api/src/rewards/rewards.service.ts`）。
  - 付与は**汎用外部連携API** `POST /api/v1/rewards/grant`（HMAC認証）経由のみで行われ、
    AIART専用のController/Service/Moduleは**一切存在しない**（`apps/api/src/ai-art/`等の
    ディレクトリなし）。
  - `docs/integration/AIART_REWARD_INTEGRATION_PLAN.md` に現状が明記されている:
    「共通基盤のみ」の実装であり、(a) 金額を`reward_rules.rewardAmount`と照合する処理が
    未実装、(b) **実際の出席確認は行っておらず、呼び出し元(AIアート教室側)を信頼するのみ**、
    (c) AIART固有の取消・キャンセル理由の記録なし、(d) CSV一括登録に
    `attendance_status`列が無い、という既知のギャップが列挙されている。
  - 重複防止は汎用の `sourceReferenceId`（event_id）ベースの `perEventLimit` チェックのみ。
    冪等キー形式は `AIART_ATTENDANCE:{EVENT_ID}:{OVE_ACCOUNT_ID}`
    （`docs/development-guardrails.md`記載）で、方針書§38-27が要求する
    「`attendance_id`等による二重付与防止」とは**キーの主体が異なる**（event_idベース vs
    attendance_idベース）。
  - `ai_art_member_id` / `ai_art_class_id` / `ai_art_course_id` / `ai_art_booking_id` /
    `attendance_id` / `artwork_id` / `exhibition_application_id` に相当するIDやテーブルは
    ウォレット側は元より、連携先のAIアート教室側の実装状況も含め現時点で不明
    （方針書§39「開発開始前の確認事項」に「AIアート教室の現行ユーザーID・ログイン方式」
    「体験申込み・予約・出欠データ」等の確認項目として明記されている＝方針書自体も
    「未確認」の前提で書かれている）。

- 決済とのタイミング分離（§19.5, §38-26）:
  方針書は「AIアート教室は、ショッピングシステムから`order.paid`等の確定通知を受ける前に、
  有料受講権を正式有効化してはいけない」と明記。現行ウォレットの`rewards/grant`は
  **HMAC認証さえ通れば即座に付与確定**する設計（呼び出し元の申告を信頼する）であり、
  「決済確定通知を経てからのみ有効化する」という前提そのものが現行の汎用付与APIには無い
  （これは方針書のいう「ショッピングシステム」自体が現行4システム構成に存在しないことの
  帰結でもあり、v2.1レポート§3「商品販売方式」の指摘と同根）。

- 代理店帰属との独立性（§2.4, §13.5, §38-28）:
  「AIアート教室への参加だけを理由に、登録紹介者や担当代理店を自動設定しない」という
  ルールは、現行ウォレットのAIART連携には**登録紹介者/代理店概念自体が接続されていない**
  ため、意図せず違反する余地もない（該当ロジックが存在しないので現状は無矛盾。ただし
  v3.0のPhase 2で`agent_link_status`/`acquisition_channel`を実装する際に、AIアート教室
  経由の登録もこのルールに従わせる設計が新規に必要になる）。

### 影響範囲

- AIアート教室固有のドメインモデル（会員・予約・出欠・受講権・作品/展示）は、
  **ウォレット側で持つべき情報ではない**（方針書§5.5「正本として管理する情報」は
  AIアート教室自身が正本、ウォレット側「管理しない情報」に暗黙的に整合）。
  ウォレットが関与するのはあくまで「参加特典としてのポイント/OVE付与」のみ
  （§19.5にウォレットの役割として明記されているのは「購入特典ポイント/クーポン/
  ガチャ券/活動特典/OVE表示残高」のみで、予約・出欠等はウォレットの管理対象外）。
- ただし現行の `AIART_ATTENDANCE_REWARD` 付与フローが、方針書の要求する
  「`attendance_id`単位の重複防止」「決済確定後のみ受講権有効化」という制御と
  整合していない点は、**AIアート教室側システムが実装されて実際に連携が始まった際に
  露見するリスク**として影響範囲に含めるべき。現行の「呼び出し元を信頼する」設計を
  維持する場合、AIアート教室側で二重送信が発生すればウォレット側も二重付与し得る
  （現状のevent_idベースdedupで一定の防御はあるが、方針書が指定する`attendance_id`との
  対応が取れていることが前提であり、その保証は現行実装にはない）。

### 必要API（案）

- 方針書が新規に定義するAIアート教室関連の論理API（§27）:
  - `POST /ai-art/members/link`（共通ID⇔ai_art_member_idの紐づけ）
  - `POST /ai-art/course-access/grant` / `POST /ai-art/course-access/revoke`
  - `POST /ai-art/attendance/complete`
  - `POST /ai-art/artworks/register`
  - これらは**すべてAIアート教室側システムが実装・提供すべきAPIであり、ウォレット側の
    実装対象ではない**。ウォレット側が関与するのは、AIアート教室からの特典付与依頼
    （現行の`POST /api/v1/rewards/grant`、または方針書の`POST /entitlements/grant`
    経由）のみ。
- ウォレット側で検討が必要な拡張:
  - `RewardGrantRequestSchema` に `attendance_id`（またはそれに相当する一意識別子）を
    正式フィールドとして追加するか、現行の`event_id`をそのまま`attendance_id`として
    運用するかの整理（現状は`event_id`のみで代替できているため、必須ではない可能性が高い）。
  - 決済確定（`order.paid`）を経由した特典付与のみ許可する、という制御をAIARTにも
    適用するかどうか（現行の無料体験系イベント参加報酬と、有料受講の受講権/特典を
    区別する設計が必要になる）。

### データ移行の有無

- **AIアート教室固有ドメイン（予約/出欠/受講権/作品）については移行対象データが
  現行ウォレット側に存在しない**（そもそも管理していないため無し）。
- **既存の`AIART_ATTENDANCE`取引（台帳上の過去付与実績）については、将来
  `attendance_id`ベースの新しい重複防止・追跡の仕組みを導入する場合、過去分の
  `event_id`と新設`attendance_id`の対応表を作るか、過去分は移行対象外として
  新規分のみ新方式に従わせるかの判断が必要**（方針書§35.1「事前調査」項目に
  「AIアート教室の会員ID」「予約・出欠・参加履歴」等が明記されており、想定内の
  調査事項ではある）。

---

## 3. 共通ユーザーID／共通顧客HUB（要旨再掲、v2.1から変更なし）— 方針書 §3.1, §7, §26.1〜26.3, §27

v2.1時点の指摘がそのまま有効。追加点は `ai_art_member_id` が `common_user_id` の子IDに
加わったこと（§7.1）のみ。詳細は旧レポート参照。

- 現行 `WalletReferral.commonUserId` は既に存在するが常時`null`（Phase 1未設定）。
- 現行 `AccountLink`（`ove_account_id`/`service_integration_id`/`external_user_id`）は
  方針書の `system_account_links`（`common_user_id`/`system_name`）と構造は類似するが、
  主語がウォレット発行の`OveAccount.id`である点が異なる。
- **データ移行: 要**（既存`OveAccount`全件への`common_user_id`付与）。

---

## 4. 登録経路・代理店関係のユーザー区分（要旨再掲、v2.1から変更なし）— 方針書 §8〜§13, §26.1, §31

- 現行`WalletReferral`は登録紹介者1種類のみ。`assigned_agent_id`/
  `order_sales_agent_id`/`order_closer_agent_id`/`agent_touchpoint`の概念は無い。
- `acquisition_channel`/`agent_link_status`は現行スキーマに存在しない
  （v3.0では`acquisition_channel`の推奨値に`ai_art_class`が追加されているが、
  項目自体の構造は変更なし）。
- **データ移行: 要検討**（既存`WalletReferral`行の`agent_link_status`への変換ルール策定）。

---

## 5. 商品販売方式 sales_model（要旨再掲、v2.1から変更なし）— 方針書 §5.3, §15, §18

- 「ショッピングシステム」自体が現行の4(5)システム構成には存在しない新規システム。
- ウォレットは「管理しない情報」として商品注文・購入権利の正本を除外済みで無矛盾。
- v3.0では`sales_model：direct_allowed`の対象例に「AIアート教室の無料体験」
  「AIアート教室の一般講座・年会費」が追加された（§15.1）。AIアート教室の有料商品も
  ショッピングシステムの`sales_model`管理下に置く方針が明確化された。
- **データ移行: 無し**。

---

## 6. ウォレット台帳・外部API（要旨再掲、v2.1から変更なし）— 方針書 §5.4, §19.4, §27

- `POST /wallet/credits`/`POST /wallet/debits`に対し、現行は
  `rewards/grant`・`transactions/debit`・`transactions/{id}/reverse`の3本立てで
  機能的にほぼ1:1対応。
- `common_user_id`フィールドは現行リクエストスキーマに無い。
- 台帳原則（付与/使用/取消/調整、残高は取引履歴から算出）は`packages/ledger`と完全に整合。
- **データ移行: 無し**。

---

## 7. イベント／Webhook連携（AIアート教室関連イベントが新規追加）— 方針書 §28, §29

### 差分

v3.0で新規追加されたAIアート教室関連イベント: `ai_art.member.linked`,
`ai_art.booking.created`, `ai_art.booking.cancelled`, `ai_art.attendance.completed`,
`ai_art.course_access.granted`, `ai_art.course_access.revoked`, `ai_art.artwork.created`,
`ai_art.exhibition.applied`。

現行ウォレットの`integration_outbox`（Transactional Outbox基盤）はイベント発行の
仕組み自体は既にあるが、上記AIアート教室系イベントの発行・購読は当然未実装
（そもそもAIアート教室が自システムのイベントをこの形式で発行しているかどうかも
未確認＝方針書§39の確認事項通り）。ウォレット側が関知すべきは
`ai_art.attendance.completed`（参加特典付与のトリガー）と
`ai_art.course_access.granted/revoked`（受講権と紐づく特典管理、あれば）程度と
考えられる。

### 影響範囲

Webhook受信口の新設が必要な点はv2.1指摘のまま変更なし（`order.*`, `entitlement.*`に
加えて`ai_art.*`系も同じ受信基盤で扱うか検討）。

### 必要API

新設。AIアート教室からの`attendance.completed`通知を受けてウォレットの
`AIART_ATTENDANCE_REWARD`付与を行う、という現行フローの「入口」を
HMAC付き汎用API呼び出しから、方針書が定義する冪等イベント受信（event_id/
schema_version/correlation_id等の共通項目付き）に置き換えるかどうかが論点。

### データ移行の有無

無し。

---

## 8. 返金・キャンセル・チャージバック連動（AIアート教室の受講権停止が追加）— 方針書 §22

### 差分

v3.0の連携フロー（§22.3）に「AIアート教室の対象受講権・会員権を停止または調整」が
追加された。現行ウォレットの`reverse`機能（手動・明示リクエストのみ）は、
AIアート教室の受講権停止とは別軸の処理であり、直接の影響は無い
（ウォレット側は「参加特典ポイント等の取消」のみを担当し、受講権自体の停止は
AIアート教室システムの責務）。

### データ移行の有無

無し。

---

## 9. クーポン仮押さえ（要旨再掲、v2.1から変更なし）— 方針書 §21

現行スキーマにクーポン関連モデルが存在しない点は変更なし。**データ移行: 無し**
（新規機能のため）。

---

## 10. 既存データ移行方針全体（AIアート教室分の事前調査項目が追加）— 方針書 §35

v3.0の§35.1「事前調査」にAIアート教室関連の項目が追加された:
「AIアート教室の会員ID」「予約・出欠・参加履歴」「講座・会員プラン」「作品・展示履歴」。

現行ウォレットには上記いずれのデータも存在しない（AIアート教室側システムに存在する
想定）ため、ウォレット側での移行作業は無い。ただし共通ID移行（§3参照）の際に、
AIアート教室側の既存ユーザーIDとの突合も同じHUB突合バッチの対象に含める必要がある
（範囲の問題であり、ウォレット固有の追加作業ではない）。

---

## まとめ（サマリ表・v3.0版）

| 領域 | 差分の大きさ | 実装済み土台 | 必要API(新設/拡張) | データ移行 |
|---|---|---|---|---|
| 共通ID/HUB | 大 | `commonUserId`が既に存在(未使用) | HUB照会/発行/link通知 (新設) | 要 |
| 代理店関係区分(5種) | 中〜大 | 登録紹介者のみ実装済み | confirm/assign/sales-context (新設) | 要(変換ルール要策定) |
| sales_model/ショップ連携 | 大(新システム) | 「管理しない」と明記済みで無矛盾 | entitlements.grant受信 (新設) | 無 |
| ウォレット台帳API | 小 | grant/debit/reverseで機能的に充足 | 既存API拡張のみで対応可能性大 | 無 |
| イベント/Webhook | 中 | outbox基盤は既存 | 注文/返金/AIアート系の受信口 (新設) | 無 |
| 返金連動取消 | 中 | reverse機能はあるが自動連携なし | refund Webhook受信 (新設) | 無 |
| クーポン | 大(未実装機能) | 無し | 4API新設 | 無 |
| **AIアート教室連携（新規）** | **大** | **汎用ServiceCode+reward/grantのみ。ドメインモデル皆無** | **attendance.completed受信、決済確定連動の受講権制御 (新設)** | **既存AIART_ATTENDANCE取引の追跡方式変更を要検討** |
| 既存データ移行手続き | 小(手法は流用可) | 移行/統合機能が既存 | HUB突合バッチ (新設) | 要 |

---

以上が調査結果である。本レポート作成にあたり、コード改修は一切行っていない。特にAIアート
教室については、現行実装が「共通基盤のみ・出席確認なし」の暫定実装であることを
`docs/integration/AIART_REWARD_INTEGRATION_PLAN.md`にて開発チーム自身が既に認識している
状態であり、v3.0の詳細なドメインモデル要求との差が最も大きい領域である。各領域の実装
範囲・優先順位は、この差分確認を踏まえた個別指示書の提示を待って確定する。
