import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient, ServiceIntegration, TransactionType } from "@ove/database";
import { debitWallet, reverseTransaction } from "@ove/ledger";
import type { DebitRequest } from "@ove/shared-types";
import { PRISMA } from "../common/prisma.module";
import { serializeTransaction } from "../wallets/wallets.service";

@Injectable()
export class TransactionsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async debit(request: DebitRequest, serviceIntegration: ServiceIntegration) {
    if (serviceIntegration.serviceCode !== request.service_code) {
      throw new BadRequestException("service_code does not match the authenticated API key");
    }

    const amount = BigInt(request.amount);
    if (amount > serviceIntegration.perRequestAmountLimit) {
      throw new BadRequestException(
        `amount exceeds per_request_amount_limit (${serviceIntegration.perRequestAmountLimit.toString()})`,
      );
    }

    const link = await this.db.accountLink.findUnique({
      where: {
        serviceIntegrationId_externalUserId: {
          serviceIntegrationId: serviceIntegration.id,
          externalUserId: request.external_user_id,
        },
      },
    });
    if (!link) throw new NotFoundException("no OVE account linked to this external_user_id");

    const wallet = await this.db.wallet.findUniqueOrThrow({ where: { oveAccountId: link.oveAccountId } });

    const transaction = await debitWallet(
      {
        walletId: wallet.id,
        amount,
        transactionType: request.transaction_type as TransactionType,
        idempotencyKey: request.idempotency_key,
        displayName: request.display_name,
        description: request.description,
        sourceService: request.service_code,
        sourceReferenceId: request.source_reference_id,
        createdByType: "EXTERNAL_SERVICE",
        createdById: serviceIntegration.id,
      },
      this.db,
    );

    return { ove_account_id: link.oveAccountId, ...serializeTransaction(transaction) };
  }

  async reverse(
    transactionId: string,
    reason: string,
    idempotencyKey: string,
    actor: { type: "EXTERNAL_SERVICE" | "ADMIN"; id: string },
  ) {
    const transaction = await reverseTransaction(
      {
        transactionId,
        reason,
        idempotencyKey,
        createdByType: actor.type,
        createdById: actor.id,
      },
      this.db,
    );
    return serializeTransaction(transaction);
  }
}
