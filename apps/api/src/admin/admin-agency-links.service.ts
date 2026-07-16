import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

/**
 * 代理店連携状態一覧 (開発ガイドライン15章「必須」項目)。
 * account_links のうち ServiceCode.AGENCY_SYSTEM に属する行だけを対象にする
 * (docs/agency-integration.md参照)。PENDING/FAILED/CONFLICTの絞り込みのうち、
 * 現在の実装ではPENDING/ACTIVE/REVOKEDのみが実際に発生しうる状態であり、
 * 自動再送・FAILED状態は今後の課題 (ENABLE_AGENCY_SYNC_RETRY) として未実装。
 */
@Injectable()
export class AdminAgencyLinksService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private async requireAgencyServiceIntegrationId(): Promise<string | undefined> {
    const integration = await this.db.serviceIntegration.findUnique({ where: { serviceCode: "AGENCY_SYSTEM" } });
    return integration?.id;
  }

  async list(params: { status?: string; limit?: number }): Promise<unknown> {
    const serviceIntegrationId = await this.requireAgencyServiceIntegrationId();
    if (!serviceIntegrationId) return [];

    return this.db.accountLink.findMany({
      where: {
        serviceIntegrationId,
        ...(params.status ? { status: params.status as never } : {}),
      },
      orderBy: { linkedAt: "desc" },
      take: params.limit ?? 100,
      include: { account: { select: { id: true, accountCode: true, displayName: true } } },
    });
  }

  async detail(id: string): Promise<unknown> {
    const link = await this.db.accountLink.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, accountCode: true, displayName: true } },
        serviceIntegration: { select: { serviceCode: true } },
      },
    });
    if (!link || link.serviceIntegration.serviceCode !== "AGENCY_SYSTEM") {
      throw new NotFoundException("agency link not found");
    }
    return link;
  }
}
