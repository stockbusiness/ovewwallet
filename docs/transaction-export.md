# 自分の取引履歴CSVエクスポート

2026-07-19実装。`GET /api/v1/me/transactions/export`。

## 仕様

- 直近10,000件を上限に、自分のウォレットの取引を新しい順にCSVで返す
  (`GET /me/transactions`一覧画面用の100件上限とは別の、エクスポート専用の上限)。
- 列: 取引コード・日時 (ISO 8601)・種別 (`transactionType`の生値)・方向 (獲得/利用)・
  金額・状態・取引後残高・内容 (`displayName`)。
- Excel(日本語版)でも文字化けせず開けるよう、UTF-8 BOM付きで返す
  (`docs/migration.md`のCSVアップロード側のUTF-8/Shift_JIS対応とは別の話題で、
  こちらは常にUTF-8のみ)。
- `Content-Type: text/csv; charset=utf-8`、
  `Content-Disposition: attachment; filename="transactions.csv"`。

## ルーティング上の注意

`GET /me/transactions/:transactionId` (取引詳細) より前に
`GET /me/transactions/export` を登録している。動的セグメントの方を先に登録すると
`export`という文字列がtransactionIdとして解決されてしまうため。

## UI

`/wallet/transactions`画面のヘッダーにダウンロードアイコンを追加。クリックすると
`fetch`でCSVを取得し、Blobとして`<a download>`経由でブラウザにダウンロードさせる
(JSON専用の`apiFetch`ヘルパーは使わず、この画面だけ生の`fetch`を使っている)。

## 動作確認

`apps/api/src/e2e/transaction-export.test.ts` (2件): ヘッダー行・BOM・自分の取引の
内容が含まれること、他人の取引は含まれないことを検証済み。

2026-07-19、Playwrightによる実ブラウザ確認を実施し、`/wallet/transactions`画面の
ダウンロードアイコンをクリックしてCSVファイルが実際にダウンロードされること、
ヘッダー行・UTF-8 BOM・取引内容 (管理者付与分の「管理者による個別付与」表記など)
が正しく含まれていることを確認した。
