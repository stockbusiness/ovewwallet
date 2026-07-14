import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __ovePrisma: PrismaClient | undefined;
}

/**
 * Nest/Next の hot-reload 環境で PrismaClient が多重生成されるのを防ぐため、
 * globalThis にキャッシュする。
 */
export const prisma: PrismaClient =
  globalThis.__ovePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__ovePrisma = prisma;
}
