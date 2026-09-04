import { BadRequestException } from "@nestjs/common";
import type { Prisma, ServiceIntegration } from "@ove/database";

/** 上限判定に必要な項目だけ。呼び出し元がロック後に再取得した行を渡すこと。 */
export type ServiceAmountLimits = Pick<
  ServiceIntegration,
  "serviceCode" | "perRequestAmountLimit" | "dailyAmountLimit"
>;

/**
 * `ServiceIntegration`の金額上限 (1リクエスト / 1日あたり) を検証する。
 *
 * `GrantExternalServiceRewardUseCase` (外部サービスAPI経由) と
 * `GrantRewardWithServiceLimitsUseCase` (代理店のORI付与イベント経由) で共有する。
 * 元は前者にのみ実装されており、後者の経路には上限が一切掛かっていなかった。
 *
 * **必ず`ServiceIntegration`行を`FOR UPDATE`でロックした`$transaction`内から呼ぶこと。**
 * 日次集計とCREDITが同一整合性単位でないと、並行リクエストが上限を突破できてしまう
 * (`ServiceIntegrationRepository.lockById`の設計理由と同じ)。
 */
export async function assertWithinServiceAmountLimits(
  tx: Prisma.TransactionClient,
  integration: ServiceAmountLimits,
  amount: bigint,
): Promise<void> {
  if (amount > integration.perRequestAmountLimit) {
    throw new BadRequestException(
      `amount exceeds per_request_amount_limit (${integration.perRequestAmountLimit.toString()})`,
    );
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayGranted = await tx.oveTransaction.aggregate({
    where: {
      sourceService: integration.serviceCode,
      status: "COMPLETED",
      direction: "CREDIT",
      occurredAt: { gte: todayStart },
    },
    _sum: { amount: true },
  });
  const grantedToday = todayGranted._sum.amount ?? 0n;
  if (grantedToday + amount > integration.dailyAmountLimit) {
    throw new BadRequestException(
      "daily_amount_limit for this service has been exceeded",
    );
  }
}
