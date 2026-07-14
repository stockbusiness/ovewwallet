# 既存ユーザー移行 (指示書15章)

## 現状の実装状況

- `migration_batches` テーブルを用意済み (旧ユーザーID・旧残高・移行元ファイル名・
  移行バッチID・実行者・検証者・実行日時・元データのハッシュ・エラー内容を保持できる構造)。
- `ove_transactions.transaction_type = OPENING_BALANCE` を移行取引として使う設計。
- **移行実行API・画面は未実装** (フェーズ6の残課題)。データ構造のみ用意している。

## 想定している移行フロー (未実装、設計のみ)

1. 旧システムのCSV/エクスポートを読み込み、`migration_batches` レコードを作成
   (`source_data_hash` に元データのハッシュを保存し改ざん検知に使う)。
2. 各ユーザーについて `findOrCreateByIdentity` 等でOVEアカウント・ウォレットを用意。
3. `packages/ledger` の `creditWallet()` を `transactionType: "OPENING_BALANCE"`,
   `displayName: "旧システムからの移行残高"` で呼び出し、`idempotencyKey` に
   バッチID+旧ユーザーIDを組み合わせたキーを使う (再実行時の二重付与防止)。
4. 残高が不明なユーザーは `ove_accounts.status = REVIEWING` とし、**推定残高は入れない**。
   `wallet` はACTIVEのまま作成しても構わないが、実際の残高付与は保留し、
   `account status: REVIEWING` を確認画面に表示する運用とする。

## 実装時の注意点 (今後実装する担当者向け)

- 移行取引も通常のCREDIT取引として扱うため、`packages/ledger/src/reconcile.ts` の
  整合性チェック対象に自然に含まれる (追加の特別処理は不要)。
- バッチ実行はAPIリクエスト1件あたりの処理件数を絞り、CSV一括付与
  (`docs/admin-operations.md`) と同様のバッチサマリ (総件数/成功/エラー等) を返す設計にする。
