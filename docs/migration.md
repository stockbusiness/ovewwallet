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

## 検証者フロー (REVIEWINGアカウントの解消)

残高不明で `REVIEWING` になったアカウントは、`POST /api/v1/admin/accounts/:accountId/resolve-review`
で解消する。検証者が旧システム側の記録などで残高を調査し、**確認できた金額のみ**を
人手で入力する (移行時と同様、推定値は一切自動で入れない)。

- 確認済み残高が0より大きい場合、`creditWallet()` を `transactionType: "OPENING_BALANCE"`
  で実行する (`idempotencyKey: MIGRATION_REVIEW_RESOLVED:${accountId}` により、同じ
  アカウントに対する二重解消は防止される)。
- 確認済み残高が0の場合は取引を作成せず、アカウントを `ACTIVE` にするのみ。
- 解消後は `ove_accounts.status = ACTIVE` になる。既に `REVIEWING` でなくなった
  アカウントに対する再解消は409で拒否される (一度解消したら取り消せない)。
- 解消は監査ログ (`MIGRATION_REVIEW_RESOLVED`) に記録される。

管理画面:

- `/migrations` — 「検証待ちアカウント (REVIEWING)」セクションで一覧表示し、
  各アカウントの詳細画面へのリンクを提供する (`GET /api/v1/admin/accounts?status=REVIEWING`
  を再利用)。
- `/accounts/[accountId]` — アカウントが `REVIEWING` の間だけ「既存ユーザー移行: 検証待ち」
  セクションが表示され、確認済み残高・調査内容を入力して解消できる。

E2Eテスト (`apps/api/src/e2e/migration-review.test.ts`) で、正の確認済み残高での解消・
残高0での解消 (取引が作成されないこと)・REVIEWING以外のアカウントへの解消要求の409拒否・
負の確認済み残高の400拒否・未認証アクセスの401を検証済み。実ブラウザでも、
`/migrations` 画面での一覧表示・アカウント詳細画面での解消操作・解消後のACTIVE反映と
成功メッセージ表示を確認済み。

## 未実装・今後の課題

- 検証者 (`verified_by`、移行実行時の入力欄) と、実際に残高を確認する検証者フローの
  権限を分離すること (現状は`SUPER_ADMIN`/`OVE_OPERATOR`であれば誰でも解消できる。
  移行実行者本人による解消を禁止する、といった職務分離は未実装)。
- 移行実行そのものを事前承認制にする (検証者が内容を確認してから実行を許可する) ことは
  未実装。今回実装したのは実行後に`REVIEWING`となったアカウントの事後解消フローである。
- 文字コード変換 (Shift_JIS等) は未対応。UTF-8のCSVのみを想定している。
