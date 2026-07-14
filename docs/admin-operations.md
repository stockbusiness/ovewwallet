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
| CSV一括付与 | `/bulk-grants` | CSVアップロード・プレビュー・実行・結果サマリ |
| 外部サービス管理 | `/service-integrations` | 一覧・緊急停止・再開 |
| 既存ユーザー移行 | `/migrations` | CSVアップロード・実行・結果サマリ (`docs/migration.md`) |
| アカウント統合 | `/accounts/merge` | 統合元→統合先へ残高・連携情報を移管 |
| 管理者操作ログ | `/audit-logs` | 監査ログ一覧 (削除UIなし) |

## 外部サービス緊急停止 (指示書5章)

`POST /api/v1/admin/service-integrations/:id/suspend` で `service_integrations.status`
を `SUSPENDED` にすると、`ExternalApiAuthGuard` はAPIキー照合時に
`status: "ACTIVE"` の連携のみを対象にするため、当該サービスの既存APIキーによる
リクエストは即座に (別途のキャッシュ無効化などを待たず) 401エラーになる。
`POST /api/v1/admin/service-integrations/:id/reactivate` で再開できる。
両操作とも監査ログ (`SERVICE_INTEGRATION_SUSPEND`/`SERVICE_INTEGRATION_REACTIVATE`) に
理由付きで記録される。E2Eテスト
(`apps/api/src/e2e/service-integration-suspend.test.ts`) で、停止後に実際のAPIリクエストが
401になり、再開後に再び成功することを確認済み。

## アカウント統合 (指示書6章・13章)

`POST /api/v1/admin/accounts/merge` (`packages/ledger/src/merge.ts` の
`mergeAccounts()`) が以下をすべて1つのDBトランザクション内で行う:

1. 統合元・統合先の両ウォレットを (デッドロック回避のためID昇順で) 行ロックする。
2. 統合元の `available_balance` を統合先へ全額移管する
   (`ACCOUNT_MERGE_OUT`/`ACCOUNT_MERGE_IN` の対になる取引を作成)。
3. `account_identities`/`account_links` の所有者 (`ove_account_id`) を統合先へ付け替える。
4. 統合元の有効なセッションをすべて無効化する (統合済みアカウントではログインできない)。
5. 統合元 `ove_accounts.status = MERGED`, `merged_into_account_id = 統合先ID` を設定する。

`idempotencyKey` は `ACCOUNT_MERGE:${sourceId}:${targetId}` で固定するため、同じ統合を
再実行しても冪等に成功する (二重の残高移管は発生しない)。同じ統合元を**別の**統合先へ
再度統合しようとした場合はエラーになる。管理画面では実行前に確認ダイアログを挟む
(取り消せない操作であるため)。高額操作に準じ `SUPER_ADMIN` ロールのみ実行できる。
E2Eテスト (`apps/api/src/e2e/account-merge.test.ts`) と、実ブラウザでの操作確認
(残高移管・identity付け替え・整合性チェックが0件のままであること) を実施済み。

## 未実装画面 (今後の課題)

アカウント詳細 (個別)、取引一覧 (全体横断)、取引取消専用画面、付与ルール管理、
APIアクセスログ、発行量の時系列グラフ。二段階承認の本ワークフロー
(アカウント統合含む高額操作の申請者/承認者分離) はフェーズ6の残課題として未着手
(アカウント統合自体はSUPER_ADMIN限定の即時実行として実装済み)。

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
- **プレビュー→実行の2段階フロー**: `POST /api/v1/admin/bulk-grants/preview` が
  ウォレットを一切更新せずに集計結果 (総件数/正常/重複/ユーザー不明/エラー/合計付与予定OVE)
  と `batchId` (`bulk_grant_batches` に `status: PREVIEWED` で保存) を返す。管理者が内容を
  確認した上で `POST /api/v1/admin/bulk-grants/execute` に同じCSVと `batchId` を渡すと
  実際に付与を実行し、対応するバッチを `status: COMPLETED` に更新する。
  (raw CSV行はDBへ保存していないため、実行時も同じCSV本文を送る必要がある)。
  E2Eテスト (`apps/api/src/e2e/bulk-grant.test.ts`) でプレビュー時に残高が変化しないこと、
  実行後に反映されること、再実行しても二重付与されないことを確認済み。

## 二段階承認 (指示書13章)

`approval_requests` テーブルのみ用意し (申請者/承認者を分離できるデータ構造)、
API・画面上のワークフロー実装はフェーズ6の課題として未着手。
