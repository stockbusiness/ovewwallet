import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { generateId, type AccountLink, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

/**
 * 代理店連携状態一覧 (開発ガイドライン15章「必須」項目)。
 * account_links のうち ServiceCode.AGENCY_SYSTEM に属する行だけを対象にする
 * (docs/agency-integration.md参照)。PENDING/FAILED/CONFLICTの絞り込みのうち、
 * 現在の実装ではPENDING/ACTIVE/REVOKEDのみが実際に発生しうる状態であり、
 * 自動再送・FAILED状態は今後の課題 (ENABLE_AGENCY_SYNC_RETRY) として未実装。
 * REVOKEDは、sengoku-ai.comから`deactivated`/`deleted`イベント
 * (外部開発者向け連携ガイド11.1章) を受信した場合に AgencyService.syncAgency()
 * が自動的に遷移させる。
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
    return this.requireLink(id);
  }

  private async requireLink(id: string) {
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

  /**
   * 代理店の担当者とORIアカウントを管理者が手動で紐付ける。
   *
   * 通常この紐付けは代理店SSOログイン (`AgencyService.linkAccount`) が作る。ただし
   * SSOが未接続の間や、担当者がLINEログインで先にウォレットを作ってしまった場合、
   * 同期だけが届いた`PENDING`の行が残り、その担当者宛の付与イベントが永久に
   * 404になる (`PointAwardRecipientResolver`)。運用でこれを解消できるようにする。
   *
   * 誰がどの紐付けをなぜ作ったかは監査ログに残す。残高が動く先を決める操作のため。
   */
  async linkManually(params: {
    id: string;
    account: string;
    adminId: string;
    reason: string;
  }): Promise<AccountLink> {
    const link = await this.requireLink(params.id);

    // REVOKEDは代理店システム側が「退会・削除された」と言ってきた状態。
    // ウォレットの管理画面から復活させると、連携元の正本と食い違う。
    if (link.status === "REVOKED") {
      throw new BadRequestException(
        "この連携は代理店システム側で解除済みです。先に代理店システム側で復活させてください",
      );
    }

    const account = await this.resolveAccount(params.account);

    // 1つのORIアカウントを複数の担当者IDへ紐付けると、別々の担当者宛の付与が
    // すべて同じ残高へ入ってしまう。取り違えの温床なので明確に拒否する。
    const conflicting = await this.db.accountLink.findFirst({
      where: {
        serviceIntegrationId: link.serviceIntegrationId,
        oveAccountId: account.id,
        status: { not: "REVOKED" },
        NOT: { id: link.id },
      },
    });
    if (conflicting) {
      throw new ConflictException(
        `このORIアカウントは既に external_id "${conflicting.externalUserId}" へ紐付いています`,
      );
    }

    const updated = await this.db.accountLink.update({
      where: { id: link.id },
      data: {
        oveAccountId: account.id,
        status: "ACTIVE",
        linkMethod: "ADMIN_MANUAL",
        verifiedAt: new Date(),
      },
    });

    await this.writeAudit({
      adminId: params.adminId,
      actionType: "AGENCY_LINK_MANUAL_LINK",
      link,
      updated,
      reason: params.reason,
    });

    return updated;
  }

  /**
   * 取り違えて紐付けた場合に、同期のみ受信済み (`PENDING`) の状態へ戻す。
   * SSOで作られた紐付けにも使える (誤った相手に紐付いたまま残す方が危険なため)。
   */
  async unlink(params: {
    id: string;
    adminId: string;
    reason: string;
  }): Promise<AccountLink> {
    const link = await this.requireLink(params.id);
    if (!link.oveAccountId) {
      throw new BadRequestException("この連携はまだORIアカウントへ紐付いていません");
    }

    const updated = await this.db.accountLink.update({
      where: { id: link.id },
      data: {
        oveAccountId: null,
        status: "PENDING",
        linkMethod: "AGENCY_SYNC",
        verifiedAt: null,
      },
    });

    await this.writeAudit({
      adminId: params.adminId,
      actionType: "AGENCY_LINK_MANUAL_UNLINK",
      link,
      updated,
      reason: params.reason,
    });

    return updated;
  }

  /** 運用担当者が画面で目にするアカウントコードでも、内部IDでも引けるようにする。 */
  private async resolveAccount(value: string) {
    const account =
      (await this.db.oveAccount.findUnique({ where: { accountCode: value } })) ??
      (await this.db.oveAccount.findUnique({ where: { id: value } }));
    if (!account) {
      throw new NotFoundException(`ORIアカウント "${value}" が見つかりません`);
    }
    // CLOSED/MERGEDのアカウントへ紐付けると、付与先が既に存在しない残高になる。
    if (account.status !== "ACTIVE") {
      throw new BadRequestException(
        `ORIアカウント "${account.accountCode}" は ${account.status} のため紐付けできません`,
      );
    }
    return account;
  }

  private async writeAudit(params: {
    adminId: string;
    actionType: string;
    link: AccountLink;
    updated: AccountLink;
    reason: string;
  }): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: params.adminId,
        actionType: params.actionType,
        targetType: "account_link",
        targetId: params.link.id,
        result: "SUCCESS",
        reason: params.reason,
        beforeData: snapshot(params.link),
        afterData: snapshot(params.updated),
      },
    });
  }
}

/** 監査ログへ残す紐付けの要点。metadata (連携先の生ペイロード) は含めない。 */
function snapshot(link: AccountLink) {
  return {
    externalUserId: link.externalUserId,
    oveAccountId: link.oveAccountId,
    status: link.status,
    linkMethod: link.linkMethod,
    verifiedAt: link.verifiedAt?.toISOString() ?? null,
  };
}
