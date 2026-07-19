import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@ove/auth";
import type { PrismaClient, OveAccount } from "@ove/database";
import { PRISMA } from "./prisma.module";

export interface AuthenticatedUserRequest extends Request {
  account: OveAccount;
  /** ログインデバイス一覧で「この端末」を判定するための、現在のリクエストのセッションID。 */
  sessionId: string;
}

/** OVE独自セッションCookieを検証し、req.account にログイン中のアカウントを積む。 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException("not authenticated");

    const session = await this.db.userSession.findUnique({
      where: { sessionTokenHash: hashSessionToken(token) },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException("session expired or revoked");
    }

    const account = await this.db.oveAccount.findUnique({ where: { id: session.oveAccountId } });
    if (!account) throw new UnauthorizedException("account not found");

    await this.db.userSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    (req as AuthenticatedUserRequest).account = account;
    (req as AuthenticatedUserRequest).sessionId = session.id;
    return true;
  }
}
