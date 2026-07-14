import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { sha256Hex, ADMIN_SESSION_COOKIE_NAME, type KeyValueStore } from "@ove/auth";
import type { AdminUser, PrismaClient } from "@ove/database";
import { PRISMA } from "./prisma.module";
import { KV_STORE } from "./kv-store.module";

export interface AuthenticatedAdminRequest extends Request {
  admin: AdminUser;
}

interface AdminSessionPayload {
  adminUserId: string;
}

export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60; // 12時間

export function adminSessionKey(token: string): string {
  return `admin-session:${sha256Hex(token)}`;
}

/** 管理画面セッションCookieを検証し、req.admin にログイン中の管理者を積む。 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[ADMIN_SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException("admin not authenticated");

    const raw = await this.kv.get(adminSessionKey(token));
    if (!raw) throw new UnauthorizedException("admin session expired");

    const { adminUserId } = JSON.parse(raw) as AdminSessionPayload;
    const admin = await this.db.adminUser.findUnique({ where: { id: adminUserId } });
    if (!admin || admin.status !== "ACTIVE") {
      throw new UnauthorizedException("admin account is not active");
    }

    (req as AuthenticatedAdminRequest).admin = admin;
    return true;
  }
}
