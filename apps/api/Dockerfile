# syntax=docker/dockerfile:1
#
# apps/api (NestJS) の本番用マルチステージビルド。
# ビルドコンテキストはリポジトリルート (docker build -f apps/api/Dockerfile .) を想定する。
# pnpmワークスペース構成のため、apps/api単体ではなく依存パッケージ
# (database/auth/ledger/shared-types/config) を含めてビルドする必要がある。

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

# ---- 依存関係のインストール (lockfileとpackage.jsonのみでキャッシュを効かせる) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/ledger/package.json packages/ledger/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

# ---- ビルド ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/database packages/database
COPY packages/auth packages/auth
COPY packages/ledger packages/ledger
COPY packages/shared-types packages/shared-types
COPY packages/config packages/config
COPY apps/api apps/api
# 依存パッケージを先にビルド (pnpm -rはワークスペースの依存グラフ順に実行される)。
# packages/database の build は `prisma generate` を含む (package.json参照)。
RUN pnpm -r --filter=./packages/* build
RUN pnpm --filter @ove/api build

# ---- 実行用イメージ ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api ./apps/api
COPY apps/api/docker-entrypoint.sh /repo/docker-entrypoint.sh
RUN chmod +x /repo/docker-entrypoint.sh
WORKDIR /repo/apps/api
EXPOSE 4000
USER node
ENTRYPOINT ["/repo/docker-entrypoint.sh"]
