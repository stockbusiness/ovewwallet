# 管理画面操作 (指示書13章・14章)

`apps/admin-wallet` (Next.js, PC向け, ポート3100)。

## 実装済み画面

| 画面 | パス | 内容 |
|---|---|---|
| 管理者ログイン | `/login` | メール+パスワード |
| OVEダッシュボード | `/dashboard` | ウォレット数・発行済み残高・累計付与/利用・残高整合性チェック結果 |
| アカウント一覧 | `/accounts` | 一覧・ウォレットへのリンク |
| ウォレット一覧 | `/wallets` | 一覧・詳細へのリンク |
| ウォレット詳細 | `/wallets/[walletId]` | 残高・個別付与/減算/保留・保留解除・最近の取引 |
| CSV一括付与 | `/bulk-grants` | CSVアップロード・実行・結果サマリ |
| 管理者操作ログ | `/audit-logs` | 監査ログ一覧 (削除UIなし) |

## 未実装画面 (今後の課題)

アカウント詳細 (個別)、取引一覧 (全体横断)、取引取消専用画面、付与ルール管理、
外部サービス管理、APIアクセスログ、アカウント統合、発行量の時系列グラフ。
API自体 (`apps/api`) 側の対応する機能 (アカウント統合、承認フロー本実装含む) も
フェーズ6の残課題として未着手。

## 管理者権限

`admin_users.role`: `SUPER_ADMIN` / `OVE_OPERATOR` / `INTEGRATION_ADMIN` /
`EVENT_OPERATOR` / `AUDITOR` / `VIEWER`。付与・減算・保留・保留解除・取消は
`SUPER_ADMIN` と `OVE_OPERATOR` のみ許可 (`apps/api/src/admin/admin.controller.ts` の
`@Roles(...)`)。監査ログ閲覧は `SUPER_ADMIN` と `AUDITOR` のみ。

## CSV一括付与の仕様

CSV形式:

```
external_user_id,amount,transaction_name,reason,event_id,idempotency_key
```

- `external_user_id` は **OVEアカウントコード** (例: `OVE-ACC-00000001`) を指定する
  (指示書のCSV列名をそのまま使っているが、外部サービスIDではなくOVE内部のアカウント
  コードを指す運用とした。理由: CSV列にservice_codeが存在しないため)。
- 処理結果: 総件数・正常件数・重複件数・ユーザー不明件数・エラー件数・合計付与予定OVE。
- 同じCSVを再実行しても、行ごとの `idempotency_key` により二重付与されない
  (実際にCSVを2回投入するテストで確認済み)。
- **簡略化した点**: 指示書の「プレビュー→管理者確認→実行」の2段階フローではなく、
  アップロードと同時に実行し結果を返す1段階フローにしている
  (`bulk_grant_batches` テーブルに実行結果を保存)。事前プレビュー画面は未実装。

## 二段階承認 (指示書13章)

`approval_requests` テーブルのみ用意し (申請者/承認者を分離できるデータ構造)、
API・画面上のワークフロー実装はフェーズ6の課題として未着手。
