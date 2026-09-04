import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import {
  GrantRewardUseCase,
  type GrantRewardParams,
  type GrantRewardResult,
} from "./grant-reward.use-case";
import { assertWithinServiceAmountLimits } from "./service-amount-limits";
import { ServiceIntegrationRepository } from "./service-integration.repository";

export interface GrantRewardWithServiceLimitsParams extends GrantRewardParams {
  /** 上限を引く連携先。認証済みのサービスコードを渡すこと (本文の自己申告値は不可)。 */
  serviceCode: string;
}

/**
 * 受取人が既に解決済みの付与に、`ServiceIntegration`の金額上限を掛けてから台帳へ書く。
 *
 * `GrantExternalServiceRewardUseCase`との違いは受取人の解決方法だけである。あちらは
 * `external_user_id`からservice linkでアカウントを作る/引くが、こちらは呼び出し元
 * (代理店のORI付与イベント) が`common_user_id`/`recipient_agent_id`から解決済みの
 * `oveAccountId`を渡す。上限の掛け方・ロック・冪等の扱いは同じにしてある。
 *
 * 代理店のORI付与経路 (`PointAwardWalletDeliveryHandler`) は`GrantRewardUseCase`を
 * 直接呼んでおり、`ServiceIntegration`の上限が一切効いていなかった。受信しただけで
 * ORI残高が増える経路に金額の歯止めが無い状態だったため、この経路を挟む。
 */
@Injectable()
export class GrantRewardWithServiceLimitsUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly serviceIntegrations: ServiceIntegrationRepository,
    private readonly grantReward: GrantRewardUseCase,
  ) {}

  async execute(
    params: GrantRewardWithServiceLimitsParams,
  ): Promise<GrantRewardResult> {
    const { serviceCode, ...grantParams } = params;

    // 冪等キーが既に処理済みなら、上限判定より前に既存取引を返す (再送は
    // 「新規リクエスト」ではないため、日次上限を二重に消費させない)。
    const existing = await this.db.oveTransaction.findUnique({
      where: { idempotencyKey: grantParams.idempotencyKey },
    });
    if (existing) {
      return { oveAccountId: grantParams.oveAccountId, transaction: existing };
    }

    const integration =
      await this.serviceIntegrations.findByServiceCode(serviceCode);
    // 連携先の行が無いまま付与を通さない。上限を引けない以上、歯止めが無い状態で
    // 残高を増やすことになるため (fail-open にしない)。
    if (!integration) {
      throw new BadRequestException(
        `service integration "${serviceCode}" is not registered`,
      );
    }

    return this.db.$transaction(async (tx) => {
      await this.serviceIntegrations.lockById(integration.id, tx);

      // ロック後に必ず再取得する。ロック待ちの間に上限や状態が変更されている
      // 可能性があるため (GrantExternalServiceRewardUseCaseと同じ理由)。
      const current = await this.serviceIntegrations.findById(
        integration.id,
        tx,
      );
      if (!current) {
        throw new BadRequestException("service integration not found");
      }
      if (current.status !== "ACTIVE") {
        throw new BadRequestException(
          `service integration is ${current.status.toLowerCase()}`,
        );
      }

      const existingInTx = await tx.oveTransaction.findUnique({
        where: { idempotencyKey: grantParams.idempotencyKey },
      });
      if (existingInTx) {
        return {
          oveAccountId: grantParams.oveAccountId,
          transaction: existingInTx,
        };
      }

      await assertWithinServiceAmountLimits(tx, current, grantParams.amount);

      const transaction = await this.grantReward.executeInTransaction(
        tx,
        grantParams,
      );
      return { oveAccountId: grantParams.oveAccountId, transaction };
    });
  }
}
