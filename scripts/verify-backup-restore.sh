#!/usr/bin/env bash
# 不足機能実装指示書 PR-W04「本番相当Backup／Restore試験」。
# docs/backup.md「残作業 4. リストア訓練の定期実施」への対応 — これまでは2026-07-17に
# 1回だけ手動でバックアップ→別DBへのリストア→行数比較を行っただけで、繰り返し実行できる
# スクリプトになっていなかった。本スクリプトはそれを非対話・自動で繰り返し実行できる形にし、
# 対象を当時の9テーブルからスキーマ全体(全テーブル)に広げる。
#
# 使い方:
#   DATABASE_URL=postgresql://... ./scripts/verify-backup-restore.sh
#
# 処理:
#   1. scripts/backup-db.sh で対象DBをバックアップする。
#   2. 同じPostgresサーバー上に使い捨てのリストア先DBを作成する。
#   3. バックアップからそのDBへリストアする。
#   4. 全テーブルの行数が完全一致することを比較する (docs/backup.mdと同じ観点、対象を拡大)。
#   5. 使い捨てDBを削除し、一時バックアップファイルを削除する (成功・失敗いずれでも実行)。
#
# 本番DBに対して直接実行すると（バックアップ取得のための）追加負荷がかかる点に注意。
# 定期実行 (例: 四半期に1回) はstaging相当のDB、または本番からリストアしたコピーに対して
# 行うことを推奨する (docs/backup.md参照)。
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "エラー: DATABASE_URL が設定されていません" >&2
  exit 1
fi

SOURCE_DATABASE_URL="${DATABASE_URL}"
DRILL_DB_NAME="ove_wallet_restore_drill_$(date -u +%Y%m%d%H%M%S)"
WORK_DIR="$(mktemp -d)"

MAINTENANCE_URL=$(node -e "
  const u = new URL(process.argv[1]);
  u.pathname = '/postgres';
  process.stdout.write(u.toString());
" "${SOURCE_DATABASE_URL}")

DRILL_DATABASE_URL=$(node -e "
  const u = new URL(process.argv[1]);
  u.pathname = '/' + process.argv[2];
  process.stdout.write(u.toString());
" "${SOURCE_DATABASE_URL}" "${DRILL_DB_NAME}")

cleanup() {
  echo "後片付け: 使い捨てDB (${DRILL_DB_NAME}) と一時ファイルを削除します"
  psql "${MAINTENANCE_URL}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${DRILL_DB_NAME}\";" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

echo "1/4 バックアップ取得中..."
DATABASE_URL="${SOURCE_DATABASE_URL}" ./scripts/backup-db.sh "${WORK_DIR}"
DUMP_FILE=$(find "${WORK_DIR}" -maxdepth 1 -name 'ove_wallet_*.dump' | head -n 1)
if [ -z "${DUMP_FILE}" ]; then
  echo "エラー: バックアップファイルが見つかりません" >&2
  exit 1
fi

echo "2/4 使い捨てDB (${DRILL_DB_NAME}) を作成中..."
psql "${MAINTENANCE_URL}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${DRILL_DB_NAME}\";"

echo "3/4 リストア中..."
pg_restore --clean --if-exists --no-owner --dbname="${DRILL_DATABASE_URL}" "${DUMP_FILE}"

echo "4/4 全テーブルの行数を比較中..."
TABLES=$(psql "${SOURCE_DATABASE_URL}" -t -A -c \
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")

MISMATCH_COUNT=0
TABLE_COUNT=0
for TABLE in ${TABLES}; do
  TABLE_COUNT=$((TABLE_COUNT + 1))
  SOURCE_COUNT=$(psql "${SOURCE_DATABASE_URL}" -t -A -c "SELECT count(*) FROM \"${TABLE}\";")
  DRILL_COUNT=$(psql "${DRILL_DATABASE_URL}" -t -A -c "SELECT count(*) FROM \"${TABLE}\";")
  if [ "${SOURCE_COUNT}" != "${DRILL_COUNT}" ]; then
    echo "  不一致: ${TABLE} (元DB=${SOURCE_COUNT}件 / リストア先=${DRILL_COUNT}件)" >&2
    MISMATCH_COUNT=$((MISMATCH_COUNT + 1))
  fi
done

if [ "${TABLE_COUNT}" -eq 0 ]; then
  echo "エラー: 比較対象のテーブルが1件も見つかりませんでした (publicスキーマが空)" >&2
  exit 1
fi

if [ "${MISMATCH_COUNT}" -gt 0 ]; then
  echo "リストア検証失敗: ${MISMATCH_COUNT}/${TABLE_COUNT} テーブルで行数が一致しませんでした" >&2
  exit 1
fi

echo "リストア検証成功: 全${TABLE_COUNT}テーブルの行数が一致しました"
