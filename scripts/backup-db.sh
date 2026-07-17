#!/usr/bin/env bash
# PostgreSQLの論理バックアップ (pg_dump、カスタム形式)。
# 実運用ギャップ対応 (docs/backup.md 参照): DBバックアップ手順が皆無だった状態への対応。
#
# 使い方:
#   DATABASE_URL=postgresql://... ./scripts/backup-db.sh [出力先ディレクトリ]
#
# 出力先ディレクトリ省略時は ./backups。ファイル名は ove_wallet_YYYYmmdd_HHMMSS.dump。
# BACKUP_RETENTION_DAYS (既定7) より古いバックアップファイルは自動的に削除する。
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "エラー: DATABASE_URL が設定されていません" >&2
  exit 1
fi

OUT_DIR="${1:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_DIR}/ove_wallet_${TIMESTAMP}.dump"

mkdir -p "${OUT_DIR}"

echo "バックアップ開始: ${OUT_FILE}"
pg_dump --format=custom --file="${OUT_FILE}" "${DATABASE_URL}"

SIZE_BYTES=$(stat -c%s "${OUT_FILE}" 2>/dev/null || stat -f%z "${OUT_FILE}")
if [ "${SIZE_BYTES}" -eq 0 ]; then
  echo "エラー: バックアップファイルが空です (${OUT_FILE})" >&2
  exit 1
fi
echo "バックアップ完了: ${OUT_FILE} (${SIZE_BYTES} bytes)"

# 保持期間を過ぎたバックアップを削除する。
find "${OUT_DIR}" -maxdepth 1 -name 'ove_wallet_*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
