import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { encryptSecret, generateOpaqueToken, hashSecret } from "@ove/auth";
import { PRISMA } from "../common/prisma.module";
import { getEncryptionKey } from "../common/encryption-key";

/** 外部サービス管理・緊急停止 (指示書5章「緊急停止」・13章「外部サービス管理」画面)。 */
@Injectable()
export class AdminServiceIntegrationsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async list() {
    return this.db.serviceIntegration.findMany({
      orderBy: { serviceCode: "asc" },
      select: {
        id: true,
        serviceCode: true,
        serviceName: true,
        status: true,
        allowedIps: true,
        dailyAmountLimit: true,
        perRequestAmountLimit: true,
        lastAccessedAt: true,
        createdAt: true,
      },
    });
  }

  private async requireIntegration(id: string) {
    const integration = await this.db.serviceIntegration.findUnique({ where: { id } });
    if (!integration) throw new NotFoundException("service integration not found");
    return integration;
  }

  /**
   * 緊急停止。status を SUSPENDED にすると、ExternalApiAuthGuard は
   * `status: "ACTIVE"` の連携のみを対象にAPIキーを照合するため、このサービスの
   * 既存APIキーは即座に (キャッシュ等を待たず) 認証エラーとなる。
   */
  async suspend(id: string, adminId: string, reason: string) {
    const before = await this.requireIntegration(id);
    const updated = await this.db.serviceIntegration.update({
      where: { id },
      data: { status: "SUSPENDED" },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "SERVICE_INTEGRATION_SUSPEND",
        targetType: "service_integration",
        targetId: id,
        result: "SUCCESS",
        reason,
        beforeData: { status: before.status },
        afterData: { status: updated.status },
      },
    });

    return updated;
  }

  /**
   * APIキーの再発行 (`packages/database/src/issue-service-integration.ts` の
   * `--rotate` と同じ処理を管理画面から行えるようにしたもの)。
   *
   * DBにはハッシュしか保存しないため、**生成した鍵を返せるのはこの応答1回だけ**。
   * 監査ログにも鍵そのものは残さない (残すと監査ログの閲覧権限がそのまま
   * 外部APIの実行権限になってしまう)。
   *
   * 旧APIキーは即座に無効になる。連携先へ新しい鍵を渡すまでの間、その連携先からの
   * リクエストは401になる。
   */
  async rotateApiKey(id: string, adminId: string, reason: string) {
    const integration = await this.requireIntegration(id);
    const apiKey = `ovk_${generateOpaqueToken(24)}`;

    await this.db.serviceIntegration.update({
      where: { id },
      data: { apiKeyHash: hashSecret(apiKey) },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "SERVICE_INTEGRATION_API_KEY_ROTATE",
        targetType: "service_integration",
        targetId: id,
        result: "SUCCESS",
        reason,
        // 鍵の生値は記録しない。いつ誰がどの連携の鍵を差し替えたかだけを残す。
        afterData: { serviceCode: integration.serviceCode, rotated: "apiKey" },
      },
    });

    return { serviceCode: integration.serviceCode, apiKey };
  }

  /**
   * HMAC署名シークレットの再発行。APIキーとは別に回せるようにしている
   * (片方だけ漏れた場合に、連携先へ渡し直す値を最小限にするため)。
   *
   * 代理店システム (`AGENCY_SYSTEM`) はHMAC署名に対応しておらず、この値は
   * 検証に使われない (`AgencyApiKeyGuard`)。再発行しても影響はない。
   */
  async rotateSigningSecret(id: string, adminId: string, reason: string) {
    const integration = await this.requireIntegration(id);
    const signingSecret = generateOpaqueToken(32);

    await this.db.serviceIntegration.update({
      where: { id },
      data: { signingSecretEncrypted: encryptSecret(signingSecret, getEncryptionKey()) },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "SERVICE_INTEGRATION_SIGNING_SECRET_ROTATE",
        targetType: "service_integration",
        targetId: id,
        result: "SUCCESS",
        reason,
        afterData: { serviceCode: integration.serviceCode, rotated: "signingSecret" },
      },
    });

    return { serviceCode: integration.serviceCode, signingSecret };
  }

  async reactivate(id: string, adminId: string, reason: string) {
    const before = await this.requireIntegration(id);
    const updated = await this.db.serviceIntegration.update({
      where: { id },
      data: { status: "ACTIVE" },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "SERVICE_INTEGRATION_REACTIVATE",
        targetType: "service_integration",
        targetId: id,
        result: "SUCCESS",
        reason,
        beforeData: { status: before.status },
        afterData: { status: updated.status },
      },
    });

    return updated;
  }
}
