import { Inject, Injectable, Logger } from "@nestjs/common";
import { AGENCY_DEACTIVATION_EVENT_TYPES, type AgencySyncRequest } from "@ove/shared-types";
import { generateId, type PrismaClient, type Prisma } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { RequestInheritanceUseCase } from "../wallet-user-referrals/request-inheritance.use-case";

const DEACTIVATION_EVENT_TYPES = new Set<string>(AGENCY_DEACTIVATION_EVENT_TYPES);

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
  private readonly logger = new Logger(AgencyService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly inheritance: RequestInheritanceUseCase,
  ) {}

  /** ServiceCode.AGENCY_SYSTEM のServiceIntegration IDを取得する (未作成ならundefined)。 */
  async getServiceIntegrationId(): Promise<string | undefined> {
    const integration = await this.db.serviceIntegration.findUnique({ where: { serviceCode: "AGENCY_SYSTEM" } });
    return integration?.id;
  }

  /**
   * `deactivated`/`deleted`イベント(ガイド11.1章)を受けてaccount_linkをREVOKEDへ
   * 遷移させる。従来はstatusを一切更新しなかったため、代理店が停止・削除されても
   * account_linkがACTIVE/PENDINGのまま残り続けるバグがあった。
   */
  async syncAgency(serviceIntegrationId: string, externalId: string, body: AgencySyncRequest): Promise<AgencySyncResult> {
    const isRevocation = body.event !== undefined && DEACTIVATION_EVENT_TYPES.has(body.event);
    const metadata = {
      agentCode: body.agent_code ?? null,
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

    const key = { serviceIntegrationId, externalUserId: externalId };
    const existing = await this.db.accountLink.findUnique({
      where: { serviceIntegrationId_externalUserId: key },
    });

    if (existing) {
      await this.db.accountLink.update({
        where: { id: existing.id },
        data: {
          metadata: metadata as unknown as Prisma.InputJsonValue,
          ...(isRevocation ? { status: "REVOKED" as const, revokedAt: new Date() } : {}),
        },
      });
    } else {
      await this.db.accountLink.create({
        data: {
          id: generateId(),
          ...key,
          status: isRevocation ? "REVOKED" : "PENDING",
          linkMethod: "AGENCY_SYNC",
          metadata: metadata as unknown as Prisma.InputJsonValue,
          ...(isRevocation ? { revokedAt: new Date() } : {}),
        },
      });
    }

    // 代理店資格を取得した人が、それ以前にウォレット経由で紹介していた関係を
    // 代理店システムへ継承申請する (`docs/wallet-user-referral.md` Phase 2)。
    // 同期の本処理 (account_linkのupsert) はここまでで完了しており、申請は
    // ベストエフォート。失敗しても同期自体を失敗させない (次の同期で拾われる)。
    if (!isRevocation && body.common_user_id) {
      await this.tryRequestWalletReferralInheritance(body.common_user_id);
    }

    return { externalId, synced: true };
  }

  /**
   * 同期で運ばれてきた`common_user_id`が既存のウォレットアカウントと一致したら、
   * そのアカウントの未申請のウォレット紹介を継承申請する。
   *
   * 同期イベントには「初回の資格取得」を区別する種別がまだ無いため、情報更新の
   * 同期でもここを通る。申請済みの紹介は`inherited_at`で除外されるので、何度
   * 通っても二重に申請しない (区別用の通知が入ったら条件を絞るだけでよい)。
   *
   * 共通IDが2アカウントに紐づく異常時は、どちらの紹介実績か決められないため
   * 何もしない (`CommonEventAccountResolver`と同じ方針)。
   */
  private async tryRequestWalletReferralInheritance(commonUserId: string): Promise<void> {
    try {
      const accounts = await this.db.oveAccount.findMany({
        where: { commonUserId },
        select: { id: true },
        take: 2,
      });
      if (accounts.length !== 1) return;

      await this.inheritance.requestForReferrer(accounts[0]!.id);
    } catch (error) {
      this.logger.warn(
        `failed to request wallet referral inheritance: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 共通顧客HUBイベント(lead_created/common_user.merged/
   * common_user.assigned_agent.updated、ガイド11.1〜11.2章)を監査ログへ記録する。
   * これらは代理店レコードの同期ではなく、ウォレット側にcommon_user_idとの
   * 紐づけがまだ無いため自動反映はできない。手動確認・将来の共通ID接続機能の
   * 実装まで、生ペイロードを保全することが目的。
   */
  async recordHubEvent(serviceIntegrationId: string, body: AgencySyncRequest): Promise<void> {
    const actionType = `AGENCY_HUB_EVENT_${(body.event ?? "unknown").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "EXTERNAL_SERVICE",
        actorId: serviceIntegrationId,
        actionType,
        targetType: "agency_common_user_hub_event",
        targetId: body.common_user_id ?? null,
        result: "SUCCESS",
        afterData: body as unknown as Prisma.InputJsonValue,
        reason: "共通顧客HUBイベントを受信(手動確認待ち、自動反映は未実装)",
      },
    });
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
