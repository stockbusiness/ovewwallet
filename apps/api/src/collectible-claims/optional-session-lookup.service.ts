import { Inject, Injectable } from "@nestjs/common";
import { hashSessionToken } from "@ove/auth";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

/**
 * NFTカードClaim導線実装指示書8章。Claim概要APIは未ログインでも呼べる公開APIだが、
 * 画面へ「ログインが必要」かどうかを返すため、`SessionAuthGuard`と違い例外を
 * 投げずにログイン状態だけを判定する。
 */
@Injectable()
export class OptionalSessionLookupService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async isLoggedIn(sessionCookieValue: string | undefined): Promise<boolean> {
    if (!sessionCookieValue) return false;
    const session = await this.db.userSession.findUnique({
      where: { sessionTokenHash: hashSessionToken(sessionCookieValue) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return false;
    return true;
  }
}
