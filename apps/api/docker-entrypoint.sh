#!/bin/sh
set -e

# コンテナ起動のたびに保留中のマイグレーションを適用してからAPIを起動する
# (Railway等のPaaSでは事前にマイグレーションを手動実行する手段が無いことが多いため、
# 起動時に毎回 `prisma migrate deploy` を実行する構成にした。冪等であり、
# 適用済みのマイグレーションは何もしない)。
echo "[entrypoint] running prisma migrate deploy..."
cd /repo/packages/database
npx prisma migrate deploy
echo "[entrypoint] migrate deploy done"

# RUN_SEED_ON_BOOT=true の場合のみ初期データ (カウンタ・初期SUPER_ADMIN・外部サービス連携の
# 初期レコード) を投入する。seed.ts はすべてupsert(update: {})で冪等なため、既存データを
# 上書きしない。デフォルトではOFFであり、明示的に有効化しない限り実行しない
# (初回デプロイ時のみ設定し、以降は外すことを想定)。
if [ "$RUN_SEED_ON_BOOT" = "true" ]; then
  echo "[entrypoint] running seed..."
  npm run seed
  echo "[entrypoint] seed done"
fi

cd /repo/apps/api
echo "[entrypoint] starting node dist/main.js (PORT=$PORT API_PORT=$API_PORT)"
exec node dist/main.js
