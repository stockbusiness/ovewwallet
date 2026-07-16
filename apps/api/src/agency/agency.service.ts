import { Inject, Injectable } from "@nestjs/common";
import type { AgencySyncRequest } from "@ove/shared-types";
import { generateId, type PrismaClient, type Prisma } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

export interface AgencySyncResult {
  externalId: string;
  synced: boolean;
}

interface AgencyLinkClaims {
  agencyName?: string;
  contactName?: string;
  contactEmail?: string;
  roleLabel?: string;
}

/**
 * 戦国経済圏代理店システム外部連携API仕様書7章: sengoku-ai.comから受信した
 * 代理店情報を、開発ガイドライン4.3章の方針に従い既存の`account_links`
 * (serviceIntegrationId + externalUserId で一意) にupsertする。OVE Walletの
 * アカウントとまだ紐付いていない場合はステータスをPENDINGのまま保持し
 * (oveAccountIdはnull)、後日SSOログイン (12章) が行われた時点でACTIVEへ遷移する。
 */
@Injectable()
export class AgencyService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** ServiceCode.AGENCY_SYSTEM のServiceIntegration IDを取得する (未作成ならundefined)。 */
  async getServiceIntegrationId(): Promise<string | undefined> {
    const integration = await this.db.serviceIntegration.findUnique({ where: { serviceCode: "AGENCY_SYSTEM" } });
    return integration?.id;
  }

  async syncAgency(serviceIntegrationId: string, body: AgencySyncRequest): Promise<AgencySyncResult> {
    const metadata = {
      parentExternalId: body.parent_external_id ?? null,
      commonUserId: body.common_user_id ?? null,
      referralToken: body.referral_token ?? null,
      name: body.name ?? null,
      contactName: body.contact_name ?? null,
      contactEmail: body.contact_email ?? null,
      loginEmail: body.login_email ?? null,
      phone: body.phone ?? null,
      role: body.role ?? null,
      roleLabel: body.role_label ?? null,
      syncStatus: body.status ?? null,
      rawPayload: body,
    } satisfies Record<string, unknown>;

    const key = { serviceIntegrationId, externalUserId: body.external_id };
    const existing = await this.db.accountLink.findUnique({
      where: { serviceIntegrationId_externalUserId: key },
    });

    if (existing) {
      await this.db.accountLink.update({
        where: { id: existing.id },
        data: { metadata: metadata as unknown as Prisma.InputJsonValue },
      });
    } else {
      await this.db.accountLink.create({
        data: {
          id: generateId(),
          ...key,
          status: "PENDING",
          linkMethod: "AGENCY_SYNC",
          metadata: metadata as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return { externalId: body.external_id, synced: true };
  }

  /**
   * SSOログイン(12章)成功時に、代理店external_idとOVEアカウントの account_link を
   * ACTIVEにする。同期(syncAgency)がまだ一度も行われていない場合は新規作成する。
   */
  async linkAccount(params: {
    serviceIntegrationId: string;
    externalId: string;
    oveAccountId: string;
    claims: AgencyLinkClaims;
  }): Promise<void> {
    const key = { serviceIntegrationId: params.serviceIntegrationId, externalUserId: params.externalId };
    const existing = await this.db.accountLink.findUnique({ where: { serviceIntegrationId_externalUserId: key } });

    const claimsMetadata = {
      name: params.claims.agencyName,
      contactName: params.claims.contactName,
      contactEmail: params.claims.contactEmail,
      roleLabel: params.claims.roleLabel,
    };
    const existingMetadata = (existing?.metadata as Record<string, unknown> | null) ?? {};
    const metadata = { ...existingMetadata, ...claimsMetadata } as unknown as Prisma.InputJsonValue;

    if (existing) {
      await this.db.accountLink.update({
        where: { id: existing.id },
        data: { oveAccountId: params.oveAccountId, status: "ACTIVE", verifiedAt: new Date(), metadata },
      });
    } else {
      await this.db.accountLink.create({
        data: {
          id: generateId(),
          ...key,
          oveAccountId: params.oveAccountId,
          status: "ACTIVE",
          linkMethod: "AGENCY_SSO",
          verifiedAt: new Date(),
          metadata,
        },
      });
    }
  }
}
