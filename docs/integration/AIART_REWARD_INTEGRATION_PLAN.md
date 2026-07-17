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
2. **(実際の不足点)** 付与金額が`reward_rules.rewardAmount`から決定されていない:
   `RewardsService.grant()`は`amount`を`request.amount`(呼び出し元が自由に指定する値)
   から取っており(41行目付近)、`enforceRuleLimits()`は件数上限のみ検証して金額の
   妥当性は検証していない。指示書7.3章は「外部側がルールコードとイベント情報を送り、
   金額はOVE側の`reward_rules`から決定する方式」を推奨しており、現状はこれに反する
   (呼び出し元がバグ・改ざんで10,000以外の値を送っても、`perRequestAmountLimit`
   以下であれば通ってしまう)。
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
  `grant()`に、`RULE_CODE_BY_TRANSACTION_TYPE`にマッピングが存在する取引タイプについては
  `request.amount`を無条件に信用せず、`rule.rewardAmount`と一致するか検証する処理を追加
  (不一致なら`BadRequestException`)。これはAIアート教室固有の変更ではなく、既存の
  `SENGOKU_REGISTRATION_BONUS`にも同じリスクがあるため、`RULE_CODE_BY_TRANSACTION_TYPE`に
  登録されている取引タイプ全般への横展開として実装する (Feature Flag
  `ENABLE_EXTERNAL_REWARD_TYPES`等で段階的に有効化し、既存の外部連携を壊さないことを
  確認しながら適用する)。
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
- `amount`を外部から自由指定させず`reward_rules.rewardAmount`から決定する検証を追加する
  (上記「不足機能」2.参照。既存の`SENGOKU_REGISTRATION_BONUS`を含む既存連携への影響を
  確認しながら段階的に適用する)。

## Feature Flag

- 既存の`ENABLE_EXTERNAL_REWARD_TYPES`(現状未使用)を、AIアート教室固有のバリデーション
  (event_id必須化等)を段階的に有効化するフラグとして使う想定。

## セキュリティリスク

- 既存のHMAC認証・APIアクセスログの仕組みをそのまま使うため、新規のリスクは限定的。
- `event_id`の重複防止が既存の`idempotency_key`ユニーク制約に依存する設計のため、
  AIアート教室側が`event_id`を正しく一意に採番できることの確認が必須
  (相手方の運用ルール確認事項、`EXTERNAL_API_GAPS.md`参照)。

## 回帰リスク

- `amount`のreward_rules照合を追加する変更は`RULE_CODE_BY_TRANSACTION_TYPE`に登録済みの
  既存の取引タイプ(`SENGOKU_REGISTRATION_BONUS`)にも影響するため、既存のE2Eテスト
  (`apps/api/src/e2e/rewards-limits.test.ts`等)が想定するリクエストの`amount`が
  `reward_rules.rewardAmount`と一致しているかを事前に確認し、一致しない既存テストが
  あれば意図的な差なのか見落としなのかを切り分けてから適用する。

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
