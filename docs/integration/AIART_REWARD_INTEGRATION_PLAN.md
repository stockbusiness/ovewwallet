# AIアート教室 10,000 OVE連携 実装計画

「OVEウォレット 今後の実装・運用指示書 v1.0」7章に基づく、AIアート教室への実参加確認・
開催回単位10,000 OVE付与の実装計画。

**前提**: `docs/integration/EXTERNAL_API_GAPS.md`の「2. AIアート教室連携」の未確認項目
(開催回ID形式・出席状態確定タイミング等)が確定するまで、本計画に基づく実コードの
実装には着手しない。

## 現在の実装 (共通基盤のみ)

- `service_integrations`に`AIART`サービスコードが登録済み (`packages/database/src/seed.ts`)
- `reward_rules`に`AIART_ATTENDANCE_REWARD`ルールが登録済み
  (`sourceService: "AIART"`、`packages/database/src/seed.ts`)
- 外部付与API (`POST /api/v1/rewards/grant`) がHMAC-SHA256署名認証・冪等性キー・
  `reward_rules`の月間/上限enforcementまで含めて実装済み
  (`apps/api/src/rewards/rewards.service.ts`)
- `AIART_ATTENDANCE`という取引タイプ→`AIART_ATTENDANCE_REWARD`ルールコードへの
  マッピングが既に存在する (`apps/api/src/rewards/rewards.service.ts:12`)
- CSV一括付与の基盤 (プレビュー・実行・冪等性、`docs/admin-operations.md`「CSV一括付与の仕様」)
  はサービス非依存の汎用実装のため、AIアート教室向けにも転用可能

## 不足機能 (実装するもの)

現行の`apps/api/src/rewards/rewards.service.ts`を実際に読んだ結果、想定より実装が
進んでいる点と、逆に見落とされていた点があったため、以下は現行コードを踏まえて
更新した内容。

1. **(既に実装済み、想定より進んでいた点)** 開催回(イベント)単位の重複防止:
   `RewardsService.enforceRuleLimits()`が`sourceReferenceId: eventId`で絞った
   `COMPLETED`件数を`rule.perEventLimit`(seed値: 1)と比較しており、同一`event_id`+
   同一ウォレットへの二重付与は既に防止されている。`event_id`(`request.event_id`)は
   `sourceReferenceId`として必須で渡す設計になっている。
2. **(実際の不足点、ただし設計判断が必要)** 付与金額が`reward_rules.rewardAmount`から
   決定されていない: `RewardsService.grant()`は`amount`を`request.amount`(呼び出し元が
   自由に指定する値)から取っており、`enforceRuleLimits()`は件数上限
   (`perUserLimit`/`perEventLimit`/`monthlyCountLimit`)のみ検証して金額の妥当性は
   検証していない。指示書7.3章は「外部側がルールコードとイベント情報を送り、金額は
   OVE側の`reward_rules`から決定する方式」を推奨しており、字義通りには現状はこれに反する。

   ただし、既存テスト(`apps/api/src/e2e/rewards-limits.test.ts`)を実際に確認したところ、
   `monthlyAmountLimit`/`globalAmountLimit`(SUM金額上限)のテストは、境界値を精密に
   検証するためにわざと`rewardAmount`(10,000)とは異なる金額(1000/1500/3000)を
   複数回に分けて送信する設計になっている。これは**`amount`が呼び出し元ごとに可変で
   あることを前提にした既存設計**であり、「`amount`は常に`rewardAmount`と完全一致
   でなければならない」という単純な検証を追加すると、この既存テストの前提と衝突する
   (作り直しが必要になる)。

   このため、対応方針は以下のいずれかを選ぶ必要があり、**業務判断が必要**:
   - (a) `amount`は`rewardAmount`以下であることのみを検証する(上限としてのみ機能させ、
     `monthlyAmountLimit`等の可変SUM設計は維持する)。既存テストへの影響は無いと見込む。
     AIアート教室連携が「開催回への参加確定で常に定額10,000 OVE」である前提なら、
     この方式でも実質的に10,000固定運用は可能(呼び出し元が正しく10,000を送る限り)。
   - (b) `AIART_ATTENDANCE`のような「1回の付与額が固定であるべき」取引タイプに限り
     `amount === rewardAmount`の完全一致を要求し、`SENGOKU_REGISTRATION_BONUS`等
     可変SUM設計が必要な取引タイプは対象外にする(取引タイプごとに検証方式を分ける)。
   - (c) 現状維持し、AIアート教室側のAPI実装レビュー(相手方が正しい金額を送ることの
     確認)で担保する(OVE側では検証しない)。

   本ドキュメントでは(a)または(b)を推奨するが、最終的な採否はAIアート教室連携の
   実装着手時にユーザーへ確認する。
3. 出席状態の確認: 「予約」だけでは付与せず「実参加確定」を確認するロジックは、
   OVE側には存在しない(呼び出されれば無条件に付与するAPIのため、AIアート教室側が
   実際に出席確定後にだけ呼び出す実装になっているかに完全に依存している)。
   OVE側で二重チェックする仕組みは無い。
4. 誤付与の取消フロー: REVERSAL自体は既存の台帳機能で可能だが、AIアート教室固有の
   「欠席・誤登録による取消理由」を記録する仕組みは未実装。
5. CSV一括連携 (API未準備の場合の代替経路): 指示書7.7章の項目
   (`external_user_id,event_id,attendance_status,attended_at,idempotency_key`)
   に対応するCSV取り込み・プレビュー画面。既存のCSV一括付与基盤を流用できるが、
   AIアート教室固有のカラム(`attendance_status`等)への対応が必要。

## 対象ファイル・対象クラス/関数 (想定)

- 変更: `apps/api/src/rewards/rewards.service.ts` — `enforceRuleLimits()`または
  `grant()`に金額検証を追加(上記「不足機能」2.の(a)/(b)いずれかの方針が決まってから)。
  `SENGOKU_REGISTRATION_BONUS`の可変SUM設計 (`apps/api/src/e2e/rewards-limits.test.ts`)
  を壊さない実装にする必要がある。
- 新規または変更: CSV一括連携が必要な場合、`apps/api/src/admin/admin-bulk-grants.service.ts`
  相当の既存CSV一括付与サービスを参考に、AIアート教室専用のCSVパーサーを追加するか、
  汎用フォーマットへの変換層を追加するか検討する。

## DB変更 (想定)

- 現状の`reward_rules`/`ove_transactions`のスキーマで開催回単位の重複防止は
  `idempotency_key`のユニーク制約のみで実現可能と見込まれ、追加のテーブルは
  不要と見込む(推奨方針: 新しい残高更新APIを作らない、指示書7.3章)。
- 開催回情報(予約・出席・欠席・キャンセル状態)自体をOVE側で正本管理するか、
  AIアート教室側の正本を都度参照するだけにするかは、指示書7.2章の確認事項次第。
  正本を持たない方針(開発ガイドライン4.4章の代理店情報と同じ考え方)が望ましいと見込む。

## API変更 (想定、契約確定後に確定)

- 既存の`POST /api/v1/rewards/grant`を再利用する方針(指示書7.3章「新しい残高更新APIを
  作らない」)。`event_id`は既に必須パラメータとして機能している(`sourceReferenceId`
  として保存・`perEventLimit`判定に使用)ため、追加のバリデーションは不要と見込む。
- `amount`の検証方式は上記「不足機能」2.の業務判断待ち。

## Feature Flag

- 既存の`ENABLE_EXTERNAL_REWARD_TYPES`(現状未使用)を、AIアート教室固有のバリデーション
  (event_id必須化等)を段階的に有効化するフラグとして使う想定。

## セキュリティリスク

- 既存のHMAC認証・APIアクセスログの仕組みをそのまま使うため、新規のリスクは限定的。
- `event_id`の重複防止が既存の`idempotency_key`ユニーク制約に依存する設計のため、
  AIアート教室側が`event_id`を正しく一意に採番できることの確認が必須
  (相手方の運用ルール確認事項、`EXTERNAL_API_GAPS.md`参照)。

## 回帰リスク

- 実際に`apps/api/src/e2e/rewards-limits.test.ts`を確認したところ、
  `monthlyAmountLimit`/`globalAmountLimit`の境界値テストは`rewardAmount`(10,000)とは
  異なる金額(1000/1500/3000)を意図的に使っている。「不足機能」2.で(a)または(b)の
  方針を採る場合、この既存テストとの整合性を保った実装にする必要がある
  ((a)の上限方式なら1000/1500/3000はいずれも10,000以下のため無改修で両立可能、
  (b)の取引タイプ限定完全一致方式でも`SENGOKU_REGISTRATION_BONUS`を対象外にすれば
  無改修で両立可能)。

## テスト項目 (指示書7.8章の受入試験に対応)

- 予約だけでは付与されない
- 出席確定後に10,000 OVE付与される
- 同じ開催回で二重付与されない
- 別の開催回ではルールに従い付与可能
- 欠席者に付与されない
- ユーザー未紐づけ時は保留またはエラーになる
- CSV再実行で二重付与されない
- 外部API再送で二重付与されない
- 誤付与をREVERSALで取消できる
- 付与結果と失敗理由が管理画面で確認できる

## 完了条件

- 上記テスト項目がすべて自動テストで検証済み
- AIアート教室側との仕様確認(`EXTERNAL_API_GAPS.md`の全項目)が完了している
- 既存の`reward_rules`/CSV一括付与の共通基盤に非互換な変更を加えていない
