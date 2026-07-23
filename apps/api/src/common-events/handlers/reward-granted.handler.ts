import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { type PrismaClient } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { CommonEventBodySchema, type CommonEventBody } from "@ove/shared-types";
import { PRISMA } from "../../common/prisma.module";
import { isFeatureEnabled } from "../../common/feature-flags";
import { serializeTransaction } from "../../wallets/wallets.service";
import { enforceRewardRuleLimits } from "../../rewards/reward-rule-limits";
import { CommonEventAccountResolver } from "../common-event-account-resolver";
import { buildAgencyMetadata } from "../common-event-handler-support";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/**
 * reward.granted。契約の共通本文にamountフィールドが無いため、metadata.amountで
 * 受け取る。次期改修指示書P0-4: 小数・0・負数を明確に拒否し (`Math.trunc`による暗黙の
 * 丸めは行わない)、`reward_rules`の各種上限 (1回上限相当のper_event_limit、日次相当の
 * per_user_limit、月次件数/金額、累計金額) を商品コード単位のルールで検証する。
 * `ENABLE_EXTERNAL_REWARD_TYPES`が無効な間はOVEを動かさず記録のみ行う。
 */
@Injectable()
export class RewardGrantedHandler implements CommonEventHandler {
  readonly eventType = "reward.granted";
  readonly schema = CommonEventBodySchema;

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountResolver: CommonEventAccountResolver,
  ) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!isFeatureEnabled("ENABLE_EXTERNAL_REWARD_TYPES")) {
      return { action: "skipped", reason: "ENABLE_EXTERNAL_REWARD_TYPES is disabled" };
    }
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");

    const resolved = await this.accountResolver.resolveByCommonUserId(
      body.common_user_id,
      "REWARD_GRANTED",
      context.authenticatedSourceSystemKey,
    );
    if (resolved.status === "not_found") {
      throw new NotFoundException(`no OVE account linked to common_user_id "${body.common_user_id}"`);
    }
    if (resolved.status === "conflict") {
      // 複数アカウントに紐づく状態でOVEを動かすと誤付与になりうるため、確実に拒否する。
      throw new BadRequestException(
        `common_user_id "${body.common_user_id}" is linked to multiple OVE accounts; refusing to grant until reviewed`,
      );
    }
    const account = resolved.account;
    const wallet = await this.db.wallet.findUniqueOrThrow({ where: { oveAccountId: account.id } });

    const metadata = (body.metadata as Record<string, unknown> | null | undefined) ?? {};
    const rawAmount = metadata["amount"];
    const numericAmount = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
    if (!Number.isInteger(numericAmount) || numericAmount <= 0 || !Number.isSafeInteger(numericAmount)) {
      throw new BadRequestException("metadata.amount must be a positive integer (decimals/zero/negative are rejected)");
    }
    const amount = BigInt(numericAmount);

    // 商品コード単位でreward_rule_codeを導出する (指示書「商品単位上限」に対応)。
    // 複数商品が同一transactionType (COMMON_EVENT_REWARD) を共有するため、rule_code単位で
    // 発行量を分離しないと月次/累計上限が他商品の発行量と混ざってしまう。
    const ruleCode = `COMMON_EVENT_REWARD:${body.product_code ?? "default"}`;
    await enforceRewardRuleLimits(this.db, {
      ruleCode,
      walletId: wallet.id,
      transactionType: "COMMON_EVENT_REWARD",
      eventId: body.event_id,
      amount,
      // product_codeが無いイベント同士は区別しようがないため、productCode指定時のみ
      // 月次/累計集計をJSONパスで絞り込む (未指定時はtransactionType全体で集計)。
      extraWhere: body.product_code
        ? { metadata: { path: ["productCode"], equals: body.product_code } }
        : undefined,
    });

    const transaction = await creditWallet(
      {
        walletId: wallet.id,
        amount,
        transactionType: "COMMON_EVENT_REWARD",
        idempotencyKey: `COMMON_EVENT_REWARD:${body.event_id}`,
        displayName: "共通イベント連携特典",
        description: `source_system_key=${context.authenticatedSourceSystemKey} product_code=${body.product_code ?? ""}`,
        sourceService: context.authenticatedSourceSystemKey,
        sourceReferenceId: body.event_id,
        createdByType: "EXTERNAL_SERVICE",
        createdById: context.authenticatedSourceSystemKey,
        metadata: buildAgencyMetadata(body, context.authenticatedSourceSystemKey),
      },
      this.db,
    );

    return { ove_account_id: account.id, ...serializeTransaction(transaction) };
  }
}
