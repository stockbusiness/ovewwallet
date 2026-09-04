import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@ove/database";
import {
  POINT_AWARD_WALLET_DELIVERY_EVENT_TYPE,
  PointAwardWalletDeliveryEventSchema,
  type PointAward,
} from "@ove/shared-types";
import type { z } from "zod";
import { GrantRewardWithServiceLimitsUseCase } from "../../rewards/grant-reward-with-service-limits.use-case";
import type {
  AuthenticatedEventContext,
  CommonEventHandler,
  CommonEventResult,
} from "../common-event-handler.interface";
import { PointAwardRecipientResolver } from "../point-award-recipient.resolver";

type PointAwardEvent = z.infer<typeof PointAwardWalletDeliveryEventSchema>;

/**
 * このウォレットが扱う残高は1種類 (ORI) だけなので、他の通貨コードを持つ付与を
 * ORIとして加算してしまわないよう、受け付ける`point_code`を明示的に限定する。
 * 未指定は「このウォレットの通貨」を意味するものとして受け付ける。
 */
const SUPPORTED_POINT_CODES = new Set(["orly", "ori", "ove"]);

/**
 * 代理店システム(sengoku-ai.com)からの `orly.point_award.wallet_delivery`
 * (`docs/integration/AGENCY_POINT_AWARD.md`)。紹介関係が確定したあとに代理店システムが
 * 決めた付与候補を受け取り、対象ユーザーのORI残高へ加算する。
 *
 * 二重付与の防止は2段構えになっている。
 *   1. `inbound_events` の `source_system_key + event_id` (`InboundEventsService`)。
 *      同じイベントの再送は台帳へ触れず、前回の結果をそのまま返す。
 *   2. 台帳の `idempotency_key` (`AGENCY_POINT_AWARD:{award_event_key}`)。
 *      event_idだけ振り直して同じ付与が再送された場合はこちらが受け止める。
 * どちらの経路でも、2回目以降は同じ`wallet_event_id`を返す (契約6章)。
 */
@Injectable()
export class PointAwardWalletDeliveryHandler
  implements CommonEventHandler<PointAwardEvent>
{
  readonly eventType = POINT_AWARD_WALLET_DELIVERY_EVENT_TYPE;
  readonly schema = PointAwardWalletDeliveryEventSchema;

  constructor(
    private readonly recipients: PointAwardRecipientResolver,
    private readonly grantReward: GrantRewardWithServiceLimitsUseCase,
  ) {}

  async handle(
    context: AuthenticatedEventContext,
    body: PointAwardEvent,
  ): Promise<CommonEventResult> {
    const award = body.point_award;
    const points = this.parsePoints(award.points);
    const pointCode = (award.point_code ?? "orly").toLowerCase();
    if (!SUPPORTED_POINT_CODES.has(pointCode)) {
      throw new BadRequestException(
        `point_code "${award.point_code}" is not handled by this wallet`,
      );
    }

    const recipientCommonUserId = award.recipient_common_user_id ?? null;
    const recipientAgentId = toIdString(award.recipient_agent_id);
    if (!recipientCommonUserId && !recipientAgentId) {
      throw new BadRequestException(
        "point_award requires recipient_common_user_id or recipient_agent_id",
      );
    }

    const resolved = await this.recipients.resolve({
      recipientCommonUserId,
      recipientAgentId,
      authenticatedSourceSystemKey: context.authenticatedSourceSystemKey,
    });
    if (resolved.status === "conflict") {
      throw new BadRequestException(
        `refusing to credit: ${resolved.reason}; needs manual review`,
      );
    }
    if (resolved.status === "not_found") {
      // 「代理店の担当者がまだウォレットへログインしていない」場合がここに来る。
      // 時間が経てば解決しうるため、404を返して`inbound_events`の再送に委ねる。
      throw new NotFoundException(
        `no ORI account found for the recipient (tried: ${resolved.attempted.join(", ") || "none"})`,
      );
    }

    const { transaction } = await this.grantReward.execute({
      // 認証済みの送信元で`ServiceIntegration`の金額上限を引く。この経路は
      // 受信しただけでORI残高が増えるため、1リクエスト/1日あたりの歯止めを掛ける
      // (以前はGrantRewardUseCaseを直接呼んでおり上限が効いていなかった)。
      serviceCode: context.authenticatedSourceSystemKey,
      oveAccountId: resolved.account.id,
      amount: BigInt(points),
      transactionType: "COMMON_EVENT_REWARD",
      idempotencyKey: `AGENCY_POINT_AWARD:${award.award_event_key}`,
      displayName: "代理店紹介の付与",
      description:
        `source_system_key=${context.authenticatedSourceSystemKey} ` +
        `award_event_key=${award.award_event_key} recipient_type=${award.recipient_type ?? ""}`,
      sourceService: context.authenticatedSourceSystemKey,
      sourceReferenceId: award.award_event_key,
      createdByType: "EXTERNAL_SERVICE",
      createdById: context.authenticatedSourceSystemKey,
      metadata: buildPointAwardMetadata(award, {
        eventId: body.event_id,
        eventType: body.event_type,
        correlationId: body.correlation_id ?? null,
        pointCode,
        sourceSystemKey: context.authenticatedSourceSystemKey,
        resolvedBy: resolved.resolvedBy,
      }),
      // 運用側が管理画面の「付与ルール」から上限を掛けられるようにしておく。
      // ルール未登録なら素通りする (enforceRewardRuleLimitsの既定挙動)。
      ruleCode: `AGENCY_POINT_AWARD:${pointCode}`,
      ruleLimitsExtraWhere: {
        metadata: { path: ["pointCode"], equals: pointCode },
      },
    });

    return {
      wallet_event_id: transaction.id,
      status: "credited",
      ove_account_id: resolved.account.id,
      award_event_key: award.award_event_key,
      points,
    };
  }

  /**
   * 小数・0・負数・安全でない整数は、丸めずに明確に拒否する
   * (`RewardGrantedHandler`と同じ方針。暗黙の丸めは残高の食い違いを生む)。
   */
  private parsePoints(raw: unknown): number {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (
      !Number.isInteger(numeric) ||
      numeric <= 0 ||
      !Number.isSafeInteger(numeric)
    ) {
      throw new BadRequestException(
        "point_award.points must be a positive integer (decimals/zero/negative are rejected)",
      );
    }
    return numeric;
  }
}

/** 数値でも文字列でも来うるIDを、DBの検索に使える文字列へ揃える。 */
function toIdString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return null;
}

/**
 * 台帳(`ove_transactions.metadata`)へ残す付与の由来。あとから「この加算はどの
 * キャンペーンの、誰の紹介によるものか」を追えるようにするためのもので、
 * 個人情報は含めない (共通顧客ID・代理店IDは連携先の内部識別子)。
 */
function buildPointAwardMetadata(
  award: PointAward,
  context: {
    eventId: string;
    eventType: string;
    correlationId: string | null;
    pointCode: string;
    sourceSystemKey: string;
    resolvedBy: string;
  },
): Prisma.InputJsonValue {
  return {
    eventId: context.eventId,
    eventType: context.eventType,
    correlationId: context.correlationId,
    sourceSystemKey: context.sourceSystemKey,
    pointCode: context.pointCode,
    recipientResolvedBy: context.resolvedBy,
    awardEventKey: award.award_event_key,
    awardId: award.id ?? null,
    campaignId: award.campaign_id ?? null,
    campaignVersionId: award.campaign_version_id ?? null,
    recipientType: award.recipient_type ?? null,
    recipientAgentId: award.recipient_agent_id ?? null,
    targetCommonUserId: award.target_common_user_id ?? null,
    triggerEventType: award.trigger_event_type ?? null,
    triggerEventId: award.trigger_event_id ?? null,
    directReferrerAgentId: award.direct_referrer_agent_id ?? null,
    upperDirectorAgentId: award.upper_director_agent_id ?? null,
    projectKey: award.project_key ?? null,
  };
}
