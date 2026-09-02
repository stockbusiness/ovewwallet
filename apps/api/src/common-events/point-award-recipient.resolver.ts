import { Inject, Injectable } from "@nestjs/common";
import type { OveAccount, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { CommonEventAccountResolver } from "./common-event-account-resolver";

export type PointAwardRecipientResult =
  | { status: "ok"; account: OveAccount; resolvedBy: "common_user_id" | "agent_id" }
  | { status: "not_found"; attempted: string[] }
  | { status: "conflict"; reason: string };

/**
 * `orly.point_award.wallet_delivery` の付与先を決める
 * (`docs/integration/AGENCY_POINT_AWARD.md` 4章)。
 *
 * 代理店システムは付与先を `recipient_common_user_id` (共通顧客ID) と
 * `recipient_agent_id` (代理店側の担当者ID) のどちらか、あるいは両方で指定してくる。
 * 共通顧客IDを先に試すのは、こちらが千ノ国全体で一意な識別子であり、
 * `recipient_agent_id` は代理店システム内でのみ一意な値だからである。
 *
 * どちらでも解決できない場合は付与しない。「代理店の担当者がまだウォレットへ
 * ログインしていない」状態が典型で、時間が経てば解決しうるため、呼び出し元は
 * これを失敗として返し、`inbound_events`の再送に委ねる。
 */
@Injectable()
export class PointAwardRecipientResolver {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountResolver: CommonEventAccountResolver,
  ) {}

  async resolve(params: {
    recipientCommonUserId?: string | null;
    recipientAgentId?: string | null;
    authenticatedSourceSystemKey: string;
  }): Promise<PointAwardRecipientResult> {
    const attempted: string[] = [];

    if (params.recipientCommonUserId) {
      attempted.push("recipient_common_user_id");
      const resolved = await this.accountResolver.resolveByCommonUserId(
        params.recipientCommonUserId,
        "POINT_AWARD_WALLET_DELIVERY",
        params.authenticatedSourceSystemKey,
      );
      if (resolved.status === "ok") {
        return { status: "ok", account: resolved.account, resolvedBy: "common_user_id" };
      }
      if (resolved.status === "conflict") {
        // 複数アカウントに紐づく状態で付与すると誤付与になるため、再送しても
        // 直らない種類の失敗として扱う (要レビュー)。
        return {
          status: "conflict",
          reason: `recipient_common_user_id is linked to ${resolved.accountIds.length} ORI accounts`,
        };
      }
    }

    if (params.recipientAgentId) {
      attempted.push("recipient_agent_id");
      const account = await this.findAccountByAgentId(params.recipientAgentId);
      if (account) return { status: "ok", account, resolvedBy: "agent_id" };
    }

    return { status: "not_found", attempted };
  }

  /**
   * 代理店システム側のID (`external_user_id`) からORIアカウントを引く。
   * `account_links`は代理店SSOログイン時に紐づくため、まだログインしていない
   * 担当者は`ove_account_id`がnullの行 (同期のみ受信済み) になる。この場合は
   * 付与先が決まらないため、見つからなかったものとして扱う。
   */
  private async findAccountByAgentId(agentId: string): Promise<OveAccount | null> {
    const link = await this.db.accountLink.findFirst({
      where: {
        externalUserId: agentId,
        status: "ACTIVE",
        oveAccountId: { not: null },
        serviceIntegration: { serviceCode: "AGENCY_SYSTEM" },
      },
      include: { account: true },
    });
    return link?.account ?? null;
  }
}
