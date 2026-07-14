# 台帳ルール (`packages/ledger`)

## 絶対に変更しないルール (指示書8章)

1. **残高を直接編集しない** — 管理画面・APIともに `wallets.available_balance` を直接UPDATEする
   経路は存在しない。すべて `packages/ledger` の関数を経由する。
2. **完了済み取引を変更しない** — `COMPLETED` 取引の `amount`/`transactionType`/理由は不変。
   取消は `reverseTransaction()` が新しい `REVERSAL` 取引を追加し、元取引は `status` のみ
   `REVERSED` に遷移する (金額・種別・理由はそのまま)。
3. **取引を削除しない** — delete系のAPI/関数を提供していない。
4. **マイナス残高禁止** — `debitWallet()` は行ロック後に `available_balance >= amount` を
   確認し、不足時は `InsufficientBalanceError` を投げて残高・取引レコードとも一切変更しない
   (監査ログにのみ拒否記録を残す)。
5. **原子性** — 行ロック・重複確認・取引作成・残高更新・監査ログ作成を単一の
   `prisma.$transaction` 内で実行する。

## 行ロックと同時実行制御

`packages/ledger/src/util.ts` の `lockWallet()` が
`SELECT ... FROM wallets WHERE id = $1 FOR UPDATE` を実行し、同一ウォレットへの
並行 CREDIT/DEBIT/HOLD を直列化する。`packages/ledger/src/concurrency.test.ts` で、
同一ウォレットへの10件同時DEBITが残高を超えて成功しないことを実PostgreSQLで検証している。

## idempotency (冪等性)

- `ove_transactions.idempotency_key` に一意制約。
- 各関数は実行前に既存取引を確認し (fast path)、存在すればそれを返す。
- 競合時は一意制約違反 (P2002) を捕捉し、再取得して返す (10並列リクエストでも1件しか
  作成されないことを `concurrency.test.ts` で検証)。
- **外部APIの上限チェック (per_user_limit 等) は idempotency チェックより後に実行する。**
  実装中、この順序を誤ったために「同じ idempotency_key での正当な再送」が上限エラーで
  拒否されてしまうバグを発見し、`apps/api/src/rewards/rewards.service.ts` で
  「まず idempotency_key の既存取引を確認し、あれば即座にそれを返す」処理を最優先にした。

## HOLD / RELEASE と残高整合性

- `holdBalance()`: `available_balance` を減らし `held_balance` を増やす。対応する
  `ove_transactions` 行は `status = HELD` とし、指示書17章の「COMPLETED取引合計」には
  含めない (保留対象として別枠管理するため)。
- `releaseHold()`: `held_balance` を減らし `available_balance` を戻す。新しい
  `RELEASE` 取引 (`status = COMPLETED`, `direction = CREDIT`) を追加する。
- **重要な設計上の注意**: `HOLD`/`RELEASE` 取引タイプは、整合性チェックの
  CREDIT/DEBIT合計から**両方とも除外**する。実装中、`RELEASE` だけを合計に含めてしまい
  「保留解除のたびに残高が過大計上される」不整合を作り込んでいたバグを発見し修正した
  (`packages/ledger/src/reconcile.ts` のコメント参照)。

## 取消 (REVERSAL) と残高整合性

`REVERSED` ステータスの取引は「取消済みだが実際に発生した取引」を表す。取消分は別の
`REVERSAL` 取引として記録されるため、整合性チェックの合計には **`COMPLETED` と
`REVERSED` の両方**を含める必要がある。`REVERSED` を合計から除外すると、取消のたびに
残高が過大計上される不整合が発生する。これも実装中に実データで発見し修正した
(`packages/ledger/src/reconcile.test.ts` に回帰テストを追加済み)。

## 定期整合性チェック (指示書17章)

```
ウォレット表示残高
＝ COMPLETED/REVERSED取引のCREDIT合計 (HOLD/RELEASEを除く)
－ COMPLETED/REVERSED取引のDEBIT合計 (HOLD/RELEASEを除く)
－ held_balance (現在保留中の金額)
```

`reconcileWallet()` / `reconcileAllWallets()` (`packages/ledger/src/reconcile.ts`) が
この計算を行い、不一致があっても自動修正はしない。管理画面ダッシュボード
(`GET /api/v1/admin/reconciliation`) から不一致ウォレット一覧を確認できる。
