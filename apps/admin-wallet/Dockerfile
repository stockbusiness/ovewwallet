# syntax=docker/dockerfile:1
#
# apps/admin-wallet (Next.js) の本番用マルチステージビルド。
# ビルドコンテキストはリポジトリルート (docker build -f apps/admin-wallet/Dockerfile .) を想定する。
# next.config.mjs の `output: "standalone"` により、実行に必要なnode_modulesのみを
# トレースした自己完結フォルダを生成できる (公式推奨のDocker構成)。

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

# ---- 依存関係のインストール ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin-wallet/package.json apps/admin-wallet/package.json
COPY packages/shared-ui/package.json packages/shared-ui/package.json
RUN pnpm install --frozen-lockfile

# ---- ビルド ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-ui packages/shared-ui
COPY apps/admin-wallet apps/admin-wallet
# ビルド時に埋め込まれるNEXT_PUBLIC_*値。実行時ではなくビルド時に必要 (Next.jsの仕様)。
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
WORKDIR /repo/apps/admin-wallet
RUN pnpm exec next build

# ---- 実行用イメージ (standalone出力のみをコピーする最小構成) ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/apps/admin-wallet/.next/standalone ./
COPY --from=build /repo/apps/admin-wallet/.next/static ./apps/admin-wallet/.next/static
WORKDIR /repo/apps/admin-wallet
EXPOSE 3100
ENV PORT=3100
USER node
CMD ["node", "server.js"]
