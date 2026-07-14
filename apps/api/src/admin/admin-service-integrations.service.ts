import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

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
