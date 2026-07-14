import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { generateOpaqueToken, verifySecret, type KeyValueStore } from "@ove/auth";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { KV_STORE } from "../common/kv-store.module";
import { ADMIN_SESSION_TTL_SECONDS, adminSessionKey } from "../common/admin-auth.guard";

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; expiresInSeconds: number }> {
    const admin = await this.db.adminUser.findUnique({ where: { email } });
    if (!admin || admin.status !== "ACTIVE" || !verifySecret(password, admin.passwordHash)) {
      throw new UnauthorizedException("invalid email or password");
    }

    const token = generateOpaqueToken(32);
    await this.kv.set(adminSessionKey(token), JSON.stringify({ adminUserId: admin.id }), ADMIN_SESSION_TTL_SECONDS);

    await this.db.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: admin.id,
        actionType: "ADMIN_LOGIN",
        targetType: "admin_user",
        targetId: admin.id,
        result: "SUCCESS",
      },
    });

    return { token, expiresInSeconds: ADMIN_SESSION_TTL_SECONDS };
  }

  async logout(token: string): Promise<void> {
    await this.kv.del(adminSessionKey(token));
  }
}
