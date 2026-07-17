# DBバックアップ・リストア

実運用ギャップ調査 (2026-07-17) で「DBバックアップ/リストア手順が皆無」と指摘された項目
への対応。PostgreSQL (`DATABASE_URL`) のみを対象とする — Redisはセッション/OTP/紹介
セッションなどTTL付きの一時データのみを保持しており、消失しても再ログイン等で復旧できる
ため、永続バックアップの対象外とする。

## スクリプト

- `scripts/backup-db.sh`: `pg_dump` (カスタム形式) でバックアップを取得する。
  ```
  DATABASE_URL=postgresql://... ./scripts/backup-db.sh [出力先ディレクトリ (既定: ./backups)]
  ```
  `BACKUP_RETENTION_DAYS` (既定7日) より古いバックアップファイルは実行のたびに自動削除する。
  空ファイルが生成された場合はエラー終了する (壊れたバックアップに気づかず保持し続けることを防ぐ)。

- `scripts/restore-db.sh`: バックアップから復元する。接続先の既存データを全て上書きする
  破壊的操作のため、`yes` の入力を要求する確認プロンプトを挟む。
  ```
  DATABASE_URL=postgresql://... ./scripts/restore-db.sh backups/ove_wallet_20260101_000000.dump
  ```

## 動作確認済み (2026-07-17)

ローカル開発DB (`ove_wallet_dev`) に対して実際にバックアップ→別DBへのリストアを実行し、
`admin_users`/`ove_accounts`/`wallets`/`ove_transactions`/`audit_logs`/`wallet_referrals`/
`wallet_referral_benefits`/`approval_requests`/`migration_batches` の行数が完全一致する
ことを確認済み。

## 定期実行の自動化 (2026-07-17対応)

`.github/workflows/backup-db.yml` で毎日18:00 UTC (日本時間 翌3:00) に自動実行するよう
実装した。`workflow_dispatch` での手動実行にも対応する。

- `deploy.yml`と同じくRailway CLI経由でその場で本番PostgreSQLの接続情報を取得するため、
  **新しいシークレットは追加していない** (`deploy.yml`が既に使っている
  `RAILWAY_API_TOKEN`/`RAILWAY_PROJECT_ID`をそのまま再利用する)。
- 取得したバックアップはGitHub Actionsのartifact (30日保持) としてアップロードする。
  これによりアプリ本体と同じコンテナ/ディスクに保存する状態は解消されるが、
  **恒久的なオブジェクトストレージ(S3等)への保存ではない** (下記残作業2.参照)。
- ワークフロー自体が失敗した場合、GitHub側の標準機能 (Actions実行失敗の通知設定)で
  検知できる。

## 残作業 (人手・運用面で必要)

1. **RAILWAY_API_TOKEN/RAILWAY_PROJECT_IDシークレットの確認**: `backup-db.yml`は
   `deploy.yml`と同じシークレットを前提にしている。これらが未設定の場合、
   ワークフローは失敗する (`deploy.yml`を一度でも実行済みであれば設定済みのはず)。
2. **恒久的な保存先(S3等)への移行**: 現状はGitHub Actions artifact (30日保持) への
   保存のみ。より長期の保持・独立したストレージが必要な場合は、アップロードステップを
   S3等へのアップロードに置き換える必要がある (アプリ本体と同じディスク/コンテナに
   保存すると、コンテナごと失われた場合にバックアップも一緒に失われるため、artifactの
   ままでも「同じコンテナに置かない」という最低限の要件は満たしている)。
3. **Railway側の自動バックアップとの役割分担**: RailwayのマネージドPostgreSQLプランに
   よっては物理バックアップ (ボリュームスナップショット) が提供される場合がある。
   契約プランを確認し、本スクリプトによる論理バックアップ (アプリ側で完結し、
   他環境への復元やDB移行にも使える) と役割を分けて運用する。
4. **リストア訓練の定期実施**: 今回の動作確認は1回限りのローカル検証。本番運用開始後は
   定期的に (例: 四半期に1回) 実際のバックアップからのリストア訓練を行い、手順の陳腐化や
   スキーマ変更による復元失敗が無いことを継続的に確認する。
5. **ENCRYPTION_KEYとの整合性**: `wallet_referrals.referral_token_encrypted` 等はアプリ側の
  `ENCRYPTION_KEY` で暗号化されている。DBだけを別環境へリストアしても、対応する
  `ENCRYPTION_KEY` が無ければ復号できない点に注意 (`docs/deployment.md`
  「ENCRYPTION_KEYのローテーション」参照)。バックアップ運用と鍵管理は必ずセットで検討する。
