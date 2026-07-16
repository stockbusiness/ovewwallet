# 既存ユーザー移行 (指示書15章)

## 実装状況

移行実行API・管理画面を実装済み。移行の実行そのものは常に二段階承認 (事前承認制) の
対象であり、申請しただけでは実行されない (下記「事前承認制・職務分離」参照)。

- `POST /api/v1/admin/migrations/request` (`apps/api/src/admin/admin-approval.service.ts`
  の `requestMigrationExecution()`): CSVの内容をそのまま承認申請として保存する。
- `POST /api/v1/admin/approval-requests/:id/approve`: 申請者本人以外の管理者が承認すると、
  このタイミングで初めて `AdminMigrationService.execute()` (`apps/api/src/admin/admin-migration.service.ts`)
  が呼ばれ、実際の移行が実行される。
- 管理画面: `/migrations` (`apps/admin-wallet/src/app/migrations/page.tsx`、申請のみ) +
  `/approval-requests` (`apps/admin-wallet/src/app/approval-requests/page.tsx`、承認・却下)。

## CSV形式

```
old_user_id,old_balance
```

`old_balance` を空欄にすると「残高不明」として扱われ、**推定残高を入れずに**
`ove_accounts.status = REVIEWING` にする (指示書の禁止事項を遵守)。

### 文字コード (UTF-8 / Shift_JIS)

`/migrations` 画面でファイル選択時に文字コード (UTF-8 / Shift_JIS) を選べる
(`apps/admin-wallet/src/app/migrations/page.tsx`)。旧システムのエクスポートが
Shift_JISであることが多いため対応した。サーバー側はCSVの内容を常にJSON文字列
(UTF-8) として受け取るだけなので、変換はブラウザ側で `TextDecoder` を使い、
アップロードされたファイルを選択された文字コードでデコードしてから送信する
形で完結する (サーバー側APIの変更は不要)。文字コードの選択を間違えると
文字化けするため、選び直した場合はファイルを再デコードする。

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

### 職務分離: 実行者本人による解消の禁止

このアカウントを移行実行時に `REVIEWING` にした管理者本人による解消は禁止する
(`AdminService.resolveReview()`)。移行実行時に `MIGRATION_SET_REVIEWING` 監査ログ
(`actorId` = 実行者、`targetId` = アカウントID) を記録しておき、解消時にこの監査ログの
`actorId` と解消しようとしている管理者を比較する。一致する場合は400
(`the verifier must be different from the admin who executed the migration
(separation of duties)`) で拒否する。監査ログが存在しない (この変更より前に作られた
REVIEWINGアカウント等、実行者を特定できない) 場合はチェックをスキップする。

E2Eテスト (`apps/api/src/e2e/migration-review.test.ts`) で、正の確認済み残高での解消・
残高0での解消 (取引が作成されないこと)・REVIEWING以外のアカウントへの解消要求の409拒否・
負の確認済み残高の400拒否・未認証アクセスの401・実行者本人による解消の400拒否と
別管理者による解消の成功を検証済み。実ブラウザでも、`/migrations` 画面での一覧表示・
アカウント詳細画面での解消操作・解消後のACTIVE反映と成功メッセージ表示を確認済み。

## 事前承認制・職務分離 (移行実行そのもの)

移行の実行は、アカウント統合 (`docs/admin-operations.md` 「二段階承認」参照) と同様に
既存の二段階承認基盤 (`ApprovalRequest`/`AdminApprovalService`) に乗せてある。金額に
関わらず常に対象で、しきい値方式ではない。

1. `POST /api/v1/admin/migrations/request` (SUPER_ADMINのみ): CSVの内容
   (`fileName`/`csvContent`/`batchName`) と申請理由を `approval_requests`
   (`request_type: MIGRATION_EXECUTION`) にそのまま保存する。この時点では
   `migration_batches` は作られず、移行は一切実行されない。
2. `POST /api/v1/admin/approval-requests/:id/approve` (SUPER_ADMIN/OVE_OPERATOR):
   申請者本人による承認は400で拒否される (`AdminApprovalService.approve()` の
   職務分離チェック、高額付与・アカウント統合と共通のロジック)。申請者と異なる
   管理者が承認して初めて、承認時点で保存されているCSVの内容で
   `AdminMigrationService.execute()` が呼ばれる。
3. 実行時の `migration_batches.executed_by` には**申請者** (移行を依頼した管理者) を、
   `verified_by` には**承認者** (CSVの内容を確認し実行を許可した管理者、＝検証者) を
   記録する。これにより「検証者が内容を確認してから実行を許可する」という要件と、
   「実行者本人が検証者を兼ねられない」という職務分離の両方を満たす。

管理画面: `/migrations` で申請 (実行はしない) → `/approval-requests` で別の管理者が
承認/却下する。承認するとその場で移行が実行され、結果 (成功件数・REVIEWING件数等) は
承認履歴のレスポンスに含まれる (画面上には反映されないため、必要なら `/migrations` の
「検証待ちアカウント (REVIEWING)」セクションで結果を確認する)。

E2Eテスト (`apps/api/src/e2e/migration.test.ts`) で、申請だけでは実行されないこと・
申請者本人による承認が400で拒否されること・別管理者の承認で実行され `executed_by`/
`verified_by` が正しく記録されること・同じCSVの再申請/再承認で二重付与されないことを
検証済み。実ブラウザ (Playwright) でも、申請→自己承認の拒否→別管理者による承認→
実際の残高反映までの一連の流れを確認済み。

## 未実装・今後の課題

現時点で把握している未実装項目はない。文字コード対応 (Shift_JIS) も含め、
このドキュメント記載の範囲は対応済み。
