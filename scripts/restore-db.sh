#!/usr/bin/env bash
# scripts/backup-db.sh で作成したバックアップからのリストア。
# 対象DBの既存データを全て上書きするため、確認プロンプトを挟む
# (destructiveな操作を安全側に倒す方針、docs/backup.md参照)。
#
# 使い方:
#   DATABASE_URL=postgresql://... ./scripts/restore-db.sh backups/ove_wallet_20260101_000000.dump
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "エラー: DATABASE_URL が設定されていません" >&2
  exit 1
fi

DUMP_FILE="${1:-}"
if [ -z "${DUMP_FILE}" ] || [ ! -f "${DUMP_FILE}" ]; then
  echo "エラー: バックアップファイルを指定してください (存在するファイルパス)" >&2
  echo "使い方: DATABASE_URL=postgresql://... ./scripts/restore-db.sh <dumpファイル>" >&2
  exit 1
fi

echo "警告: このリストアは接続先DBの既存データを上書きします。"
echo "  リストア先: ${DATABASE_URL}"
echo "  バックアップファイル: ${DUMP_FILE}"
read -r -p "続行しますか？ (yesと入力): " CONFIRMATION
if [ "${CONFIRMATION}" != "yes" ]; then
  echo "中止しました。"
  exit 1
fi

echo "リストア開始..."
pg_restore --clean --if-exists --no-owner --dbname="${DATABASE_URL}" "${DUMP_FILE}"
echo "リストア完了。"
