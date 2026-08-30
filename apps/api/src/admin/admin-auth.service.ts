import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  buildTotpUri,
  decryptSecret,
  encryptSecret,
  findMatchingTotpCounter,
  generateOpaqueToken,
  generateTotpSecret,
  sha256Hex,
  verifySecret,
  type KeyValueStore,
} from "@ove/auth";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { KV_STORE } from "../common/kv-store.module";
import { ADMIN_SESSION_TTL_SECONDS, adminSessionKey } from "../common/admin-auth.guard";
import { getEncryptionKey } from "../common/encryption-key";

const MFA_PENDING_TTL_SECONDS = 5 * 60; // MFAコード入力の猶予は5分
const MFA_ISSUER = "戦国ウォレット管理画面";
// TOTPの許容ドリフト窓 (±1ステップ=最大90秒) を覆えれば十分。それ以前のコードは
// verifyTotpCode自体が時刻判定で拒否するため、このTTLを長く保つ意味はない。
const MFA_LAST_COUNTER_TTL_SECONDS = 10 * 60;

function mfaPendingKey(mfaToken: string): string {
  return `admin-mfa-pending:${sha256Hex(mfaToken)}`;
}

type MfaAction = "login" | "enable" | "disable";

// アクションごとに直近使用済みステップを分けて記録する。ログイン2段階目・MFA有効化・
// MFA無効化は別々の前提条件 (mfaToken/セッション/パスワード) がないと呼べないため、
// 「同一アクションへの同一コードでの再送」だけを確実に防げれば、傍受されたコードを
// そのリクエストへそのまま再送するという典型的なTOTPリプレイは塞げる。
function mfaLastCounterKey(adminId: string, action: MfaAction): string {
  return `admin-mfa-last-counter:${action}:${adminId}`;
}

export type AdminLoginResult =
  | { mfaRequired: true; mfaToken: string }
  | { mfaRequired: false; token: string; expiresInSeconds: number };

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  /** MFA未設定の管理者はそのままログインし、設定済みなら仮トークンを返して2段階目を要求する。 */
  async login(email: string, password: string): Promise<AdminLoginResult> {
    const admin = await this.db.adminUser.findUnique({ where: { email } });
    if (!admin || admin.status !== "ACTIVE" || !verifySecret(password, admin.passwordHash)) {
      throw new UnauthorizedException("invalid email or password");
    }

    if (admin.mfaEnabled) {
      const mfaToken = generateOpaqueToken(32);
      await this.kv.set(mfaPendingKey(mfaToken), JSON.stringify({ adminUserId: admin.id }), MFA_PENDING_TTL_SECONDS);
      return { mfaRequired: true, mfaToken };
    }

    const session = await this.issueSessionAndAudit(admin.id);
    return { mfaRequired: false, ...session };
  }

  /** ログイン時2段階目: パスワード認証済みの仮トークン + TOTPコードでセッションを発行する。 */
  async completeMfaLogin(mfaToken: string, code: string): Promise<{ token: string; expiresInSeconds: number }> {
    const raw = await this.kv.get(mfaPendingKey(mfaToken));
    if (!raw) throw new UnauthorizedException("MFA challenge expired or invalid");
    const { adminUserId } = JSON.parse(raw) as { adminUserId: string };

    const admin = await this.db.adminUser.findUnique({ where: { id: adminUserId } });
    if (!admin || admin.status !== "ACTIVE" || !admin.mfaEnabled || !admin.mfaSecretEncrypted) {
      throw new UnauthorizedException("MFA is not available for this account");
    }
    const secret = decryptSecret(admin.mfaSecretEncrypted, getEncryptionKey());
    if (!(await this.verifyTotpCodeOnce(admin.id, "login", secret, code))) {
      throw new UnauthorizedException("invalid MFA code");
    }

    await this.kv.del(mfaPendingKey(mfaToken)); // 使い捨てトークン
    return this.issueSessionAndAudit(admin.id);
  }

  async logout(token: string): Promise<void> {
    await this.kv.del(adminSessionKey(token));
  }

  /** MFA設定を開始する。enableMfa()で確認するまでは既存ログインに影響しない。 */
  async setupMfa(adminId: string): Promise<{ secret: string; otpauthUri: string }> {
    const admin = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    const secret = generateTotpSecret();
    await this.db.adminUser.update({
      where: { id: adminId },
      data: { mfaSecretEncrypted: encryptSecret(secret, getEncryptionKey()), mfaEnabled: false, mfaEnrolledAt: null },
    });
    const otpauthUri = buildTotpUri({ secret, accountName: admin.email, issuer: MFA_ISSUER });
    return { secret, otpauthUri };
  }

  /** setupMfa() で発行したシークレットに対する確認コードを検証し、MFAを有効化する。 */
  async enableMfa(adminId: string, code: string): Promise<void> {
    const admin = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!admin.mfaSecretEncrypted) {
      throw new BadRequestException("MFA setup has not been started");
    }
    const secret = decryptSecret(admin.mfaSecretEncrypted, getEncryptionKey());
    if (!(await this.verifyTotpCodeOnce(adminId, "enable", secret, code))) {
      throw new UnauthorizedException("invalid MFA code");
    }
    await this.db.adminUser.update({ where: { id: adminId }, data: { mfaEnabled: true, mfaEnrolledAt: new Date() } });
    await this.logAdminAudit(adminId, "ADMIN_MFA_ENABLED");
  }

  /** パスワードと現在のTOTPコードの両方を要求してMFAを無効化する。 */
  async disableMfa(adminId: string, password: string, code: string): Promise<void> {
    const admin = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!verifySecret(password, admin.passwordHash)) {
      throw new UnauthorizedException("invalid password");
    }
    if (!admin.mfaEnabled || !admin.mfaSecretEncrypted) {
      throw new BadRequestException("MFA is not enabled");
    }
    const secret = decryptSecret(admin.mfaSecretEncrypted, getEncryptionKey());
    if (!(await this.verifyTotpCodeOnce(adminId, "disable", secret, code))) {
      throw new UnauthorizedException("invalid MFA code");
    }
    await this.db.adminUser.update({
      where: { id: adminId },
      data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaEnrolledAt: null },
    });
    await this.logAdminAudit(adminId, "ADMIN_MFA_DISABLED");
  }

  /**
   * TOTPコードを検証し、一致したステップを (adminId, action) 単位で直近使用済みとして
   * 記録する。同じコード(≒同じステップ)が同じアクションに既に使用済みであれば、
   * 時刻的には有効な窓内でも拒否する (リプレイ防止。RFC 6238が推奨する
   * 「直近使用済みステップの記録」)。
   */
  private async verifyTotpCodeOnce(adminId: string, action: MfaAction, secret: string, code: string): Promise<boolean> {
    const counter = findMatchingTotpCounter(secret, code);
    if (counter === null) return false;

    const key = mfaLastCounterKey(adminId, action);
    const lastUsedRaw = await this.kv.get(key);
    const lastUsedCounter = lastUsedRaw !== undefined ? Number(lastUsedRaw) : null;
    if (lastUsedCounter !== null && counter <= lastUsedCounter) {
      return false;
    }

    await this.kv.set(key, String(counter), MFA_LAST_COUNTER_TTL_SECONDS);
    return true;
  }

  private async logAdminAudit(adminId: string, actionType: string): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType,
        targetType: "admin_user",
        targetId: adminId,
        result: "SUCCESS",
      },
    });
  }

  private async issueSessionAndAudit(adminId: string): Promise<{ token: string; expiresInSeconds: number }> {
    const token = generateOpaqueToken(32);
    await this.kv.set(adminSessionKey(token), JSON.stringify({ adminUserId: adminId }), ADMIN_SESSION_TTL_SECONDS);

    await this.db.adminUser.update({ where: { id: adminId }, data: { lastLoginAt: new Date() } });
    await this.logAdminAudit(adminId, "ADMIN_LOGIN");

    return { token, expiresInSeconds: ADMIN_SESSION_TTL_SECONDS };
  }
}
