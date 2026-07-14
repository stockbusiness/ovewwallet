# 既存ユーザー移行 (指示書15章)

## 実装状況

移行実行API・管理画面を実装済み。

- `POST /api/v1/admin/migrations/execute` (`apps/api/src/admin/admin-migration.service.ts`)
- 管理画面: `/migrations` (`apps/admin-wallet/src/app/migrations/page.tsx`)

## CSV形式

```
old_user_id,old_balance
```

`old_balance` を空欄にすると「残高不明」として扱われ、**推定残高を入れずに**
`ove_accounts.status = REVIEWING` にする (指示書の禁止事項を遵守)。

## 処理内容

1. CSV全体のSHA-256ハッシュを `migration_batches.source_data_hash` として保存
   (改ざん検知・再実行時の同一性確認に使う)。
2. `migration_batches` レコードを作成 (`batch_name`・`source_file_name`・`executed_by`・
   `verified_by`・`status: RUNNING`)。
3. 各行について、`account_identities` (`provider: "LEGACY_SYSTEM"`,
   `provider_subject: old_user_id`) でOVEアカウント・ウォレットを解決/自動作成する
   (`AccountsService.findOrCreateByIdentity` を再利用。`IdentityType` enumに
   `LEGACY_SYSTEM` を追加した)。
4. `old_balance` が数値なら `packages/ledger` の `creditWallet()` を
   `transactionType: "OPENING_BALANCE"`, `displayName: "旧システムからの移行残高"` で実行。
   `old_balance` が空欄ならアカウントを `REVIEWING` にするのみで、残高付与は行わない。
5. `migration_batches` を `status: COMPLETED` に更新し、`success_count`/`reviewing_count`/
   `error_detail` を保存する。

## idempotency (二重付与防止)

`idempotencyKey` は `` `OPENING_BALANCE:${sourceDataHash}:${oldUserId}` `` とし、
**バッチID (`migration_batches.id`) は使わない**。実装当初、キーにバッチIDを含めていたが、
バッチIDは実行のたびに新規生成されるため、同じCSVを再実行すると毎回異なる
idempotencyKeyになってしまい、「同じCSVを再実行しても二重付与されない」という要件を
満たせないバグがあった。CSV内容のハッシュを使うことで、同一内容のCSVを再実行しても
同じキーになり、`creditWallet()` 側の冪等性チェックで二重付与を防げるよう修正した。
E2Eテスト (`apps/api/src/e2e/migration.test.ts`) で、既知残高の付与・残高不明時の
REVIEWING遷移・同じCSVの再実行で残高が変わらないことを確認済み。

## 未実装・今後の課題

- 検証者 (`verified_by`) の入力UIは用意しているが、実際の承認ワークフロー
  (検証者が内容を確認してから実行を許可する、といった二段階の流れ) は未実装。
- 移行後の `REVIEWING` アカウントを一覧・確認するための専用画面は未実装
  (現状はアカウント一覧画面の `status` 列でのみ確認可能)。
- 文字コード変換 (Shift_JIS等) は未対応。UTF-8のCSVのみを想定している。
