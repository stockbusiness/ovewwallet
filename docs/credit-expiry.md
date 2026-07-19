# OVE有効期限・自動失効

2026-07-19実装。付与ルール (`reward_rules`) 経由で獲得したOVEに、任意で有効期限を
設定できる機能。管理者による個別付与・CSV一括付与・既存ユーザー移行のインポートは
対象外 (これらは「正誤訂正」や「移行」であり、消費期限のある「キャンペーン特典」とは
性質が異なるという業務判断)。

## 仕組み

- `reward_rules.expiry_days` (nullable): このルール経由の付与が何日で失効するかを
  ルールごとに設定する。未設定 (null) なら失効しない (既定)。
- `ove_credit_lots` テーブル: `expiry_days` が設定されたルール経由のCREDIT取引1件に
  つき1行作成される「ロット」。`amount` (元の付与額) と `remaining_amount`
  (未消費残額) を別に持つ。
- **FIFO消費**: DEBIT (利用) が発生すると、有効期限が近いロットから優先的に
  `remaining_amount` を減らす (`packages/ledger/src/util.ts` の
  `consumeCreditLotsFifo`)。ロットが存在しないウォレット (失効ポリシー未設定の
  付与のみを保有) では何もしない。
- **失効バッチ**: `expireDueCreditLots()` (`packages/ledger/src/expiry.ts`)。
  有効期限が到来し、かつ`remaining_amount > 0`のロットをウォレットごとに集計し、
  `available_balance`を超えない範囲でEXPIRATION (DEBIT) 取引を1件作成する
  (既にユーザーが使い切った分は失効させない)。
- **取消(REVERSAL)との整合性**: 付与ルール経由のCREDIT取引がREVERSALで取り消された
  場合、対応するロットは残額に関わらず無効化される (`voided_at`をセットし
  `remaining_amount=0`)。DEBIT取引の取消 (返金) では、消費済みロットの復元は
  行わない (安全側の単純化: 過剰に失効させるより、失効させ損ねる方を許容する)。

## 運用

管理画面の「付与ルール管理」(`/reward-rules`) で:

1. ルール作成時に「有効期限 (日)」を指定できる (空欄なら失効しない)。
2. 「OVE失効バッチを今すぐ実行」ボタンから `POST /api/v1/admin/expire-credits`
   (`SUPER_ADMIN`/`OVE_OPERATOR`) を手動実行できる。

**既知の制約**: このリポジトリにはcron等の外部スケジューラが含まれていないため、
自動失効を実運用するには外部のスケジューラ (GitHub Actions の `schedule` トリガー等)
から上記APIを定期的に呼び出す仕組みを別途用意する必要がある。手動実行のみでは、
有効期限が到来してから実際に失効するまでにタイムラグが生じる。

## 動作確認

`packages/ledger/src/expiry.test.ts` (6件): ロット作成、expiresAt未指定時の
非破壊性、FIFO消費、REVERSALによるロット無効化、失効バッチの実行、一部消費後の
残額のみ失効、を検証済み。管理画面・ユーザー画面の実ブラウザ確認は未実施
(今後の課題)。

ユーザー向け「貯める」画面 (`/wallet/earn`) には有効期限が設定されたルールについて
「獲得から○日で失効します」という案内を表示する。取引履歴一覧 (`/wallet/transactions`)
には「失効」フィルタタブを追加した。
