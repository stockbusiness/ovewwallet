import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  PrismaClient,
  ServiceIntegration,
  TransactionType,
} from "@ove/database";
import { debitWallet, reverseTransaction } from "@ove/ledger";
import type { DebitRequest } from "@ove/shared-types";
import { toCsv } from "../common/csv";
import { PRISMA } from "../common/prisma.module";
import {
  RULE_CODE_BY_TRANSACTION_TYPE,
  transactionTypesForRuleCode,
} from "../rewards/rule-code-mapping";
import { serializeTransaction } from "../wallets/wallets.service";

const SERVICE_TRANSACTIONS_EXPORT_PAGE_SIZE = 10_000;
/** 日次〜月次照合を想定した上限。より広い範囲が必要なら呼び出し側で分割リクエストする。 */
const SERVICE_TRANSACTIONS_EXPORT_MAX_RANGE_DAYS = 92;

export interface ExportServiceTransactionsParams {
  periodFrom: Date;
  periodTo: Date;
  ruleCode?: string;
  /** 前回レスポンスの`nextCursor`。未指定なら先頭から返す。 */
  cursor?: string;
}

export interface ExportServiceTransactionsResult {
  csv: string;
  hasMore: boolean;
  /** hasMoreがtrueのときのみ非null。次回呼び出しの`cursor`にそのまま渡す。 */
  nextCursor: string | null;
}

interface ExportCursor {
  occurredAt: string;
  id: string;
}

function encodeCursor(cursor: ExportCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): ExportCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException(`cursor "${raw}" is not valid`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as ExportCursor).occurredAt !== "string" ||
    typeof (parsed as ExportCursor).id !== "string" ||
    Number.isNaN(new Date((parsed as ExportCursor).occurredAt).getTime())
  ) {
    throw new BadRequestException(`cursor "${raw}" is not valid`);
  }
  return parsed as ExportCursor;
}

@Injectable()
export class TransactionsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async debit(request: DebitRequest, serviceIntegration: ServiceIntegration) {
    if (serviceIntegration.serviceCode !== request.service_code) {
      throw new BadRequestException(
        "service_code does not match the authenticated API key",
      );
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
    if (!link || !link.oveAccountId)
      throw new NotFoundException(
        "no OVE account linked to this external_user_id",
      );

    const wallet = await this.db.wallet.findUniqueOrThrow({
      where: { oveAccountId: link.oveAccountId },
    });

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

    return {
      ove_account_id: link.oveAccountId,
      ...serializeTransaction(transaction),
    };
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

  /**
   * 千ノ国パスポート等との日次照合の障害時復旧手段 (idempotency_key単発照会)。
   * 存在しない取引・他サービスの取引のいずれも同じ404にし、他サービスの取引の
   * 存在自体を漏らさない (残高照会APIの横断禁止方針と同じ)。
   */
  async findByIdempotencyKeyForService(
    idempotencyKey: string,
    serviceIntegration: ServiceIntegration,
  ) {
    const transaction = await this.db.oveTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (
      !transaction ||
      transaction.createdByType !== "EXTERNAL_SERVICE" ||
      transaction.createdById !== serviceIntegration.id
    ) {
      throw new NotFoundException("transaction not found");
    }
    const externalUserId = await this.resolveExternalUserId(
      transaction.walletId,
      serviceIntegration.id,
    );
    return serializeServiceTransaction(transaction, externalUserId);
  }

  /**
   * 外部サービス向け日次照合CSV。認証済みserviceIntegrationが自ら付与・利用した
   * 取引のみを対象にする (残高照会APIと同じ横断禁止方針)。
   *
   * 1ページ最大`SERVICE_TRANSACTIONS_EXPORT_PAGE_SIZE`件。超過分を無言で切り捨てず、
   * `occurred_at, id`昇順のキーセットページネーション(cursor)で続きを返す。
   * 照合APIとして欠落を許さないため、無言truncateはしない。
   */
  async exportServiceTransactionsCsv(
    params: ExportServiceTransactionsParams,
    serviceIntegration: ServiceIntegration,
  ): Promise<ExportServiceTransactionsResult> {
    if (params.periodFrom.getTime() > params.periodTo.getTime()) {
      throw new BadRequestException("period_from must not be after period_to");
    }
    const rangeDays =
      (params.periodTo.getTime() - params.periodFrom.getTime()) /
      (24 * 60 * 60 * 1000);
    if (rangeDays > SERVICE_TRANSACTIONS_EXPORT_MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `period_from..period_to must not exceed ${SERVICE_TRANSACTIONS_EXPORT_MAX_RANGE_DAYS} days`,
      );
    }

    let transactionTypeFilter: string[] | undefined;
    if (params.ruleCode) {
      transactionTypeFilter = transactionTypesForRuleCode(params.ruleCode);
      if (transactionTypeFilter.length === 0) {
        throw new BadRequestException(`unknown rule_code "${params.ruleCode}"`);
      }
    }

    const cursor = params.cursor ? decodeCursor(params.cursor) : null;

    const transactions = await this.db.oveTransaction.findMany({
      where: {
        createdByType: "EXTERNAL_SERVICE",
        createdById: serviceIntegration.id,
        occurredAt: { gte: params.periodFrom, lte: params.periodTo },
        ...(transactionTypeFilter
          ? {
              transactionType: {
                in: transactionTypeFilter as TransactionType[],
              },
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { occurredAt: { gt: new Date(cursor.occurredAt) } },
                {
                  occurredAt: new Date(cursor.occurredAt),
                  id: { gt: cursor.id },
                },
              ],
            }
          : {}),
      },
      // occurred_atだけでは同時刻の複数取引で順序が不定になるため、idを第2キーにして
      // 安定させる (このページネーションの前提でもある)。
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: SERVICE_TRANSACTIONS_EXPORT_PAGE_SIZE + 1,
    });

    const hasMore = transactions.length > SERVICE_TRANSACTIONS_EXPORT_PAGE_SIZE;
    const pageTransactions = hasMore
      ? transactions.slice(0, SERVICE_TRANSACTIONS_EXPORT_PAGE_SIZE)
      : transactions;

    const externalUserIdByWalletId = await this.resolveExternalUserIdsByWallet(
      pageTransactions.map((t) => t.walletId),
      serviceIntegration.id,
    );

    const header = [
      "transaction_id",
      "idempotency_key",
      "external_user_id",
      "amount",
      "transaction_type",
      "rule_code",
      "occurred_at",
      "status",
    ];
    const rows = pageTransactions.map((t) => [
      t.id,
      t.idempotencyKey,
      externalUserIdByWalletId.get(t.walletId) ?? "",
      t.amount.toString(),
      t.transactionType,
      RULE_CODE_BY_TRANSACTION_TYPE[t.transactionType] ?? "",
      t.occurredAt.toISOString(),
      t.status,
    ]);

    const lastTransaction = pageTransactions[pageTransactions.length - 1];
    const nextCursor =
      hasMore && lastTransaction
        ? encodeCursor({
            occurredAt: lastTransaction.occurredAt.toISOString(),
            id: lastTransaction.id,
          })
        : null;

    return { csv: toCsv(header, rows), hasMore, nextCursor };
  }

  private async resolveExternalUserId(
    walletId: string,
    serviceIntegrationId: string,
  ): Promise<string | null> {
    const map = await this.resolveExternalUserIdsByWallet(
      [walletId],
      serviceIntegrationId,
    );
    return map.get(walletId) ?? null;
  }

  /** walletId -> external_user_id (このserviceIntegration視点) をまとめて解決する。 */
  private async resolveExternalUserIdsByWallet(
    walletIds: string[],
    serviceIntegrationId: string,
  ): Promise<Map<string, string>> {
    const uniqueWalletIds = [...new Set(walletIds)];
    if (uniqueWalletIds.length === 0) return new Map();

    const wallets = await this.db.wallet.findMany({
      where: { id: { in: uniqueWalletIds } },
      select: { id: true, oveAccountId: true },
    });
    const oveAccountIdByWalletId = new Map(
      wallets.map((w) => [w.id, w.oveAccountId]),
    );

    const oveAccountIds = [...new Set(wallets.map((w) => w.oveAccountId))];
    const links = await this.db.accountLink.findMany({
      where: {
        serviceIntegrationId,
        oveAccountId: { in: oveAccountIds },
        status: "ACTIVE",
      },
      select: { oveAccountId: true, externalUserId: true },
    });
    const externalUserIdByOveAccountId = new Map(
      links.map((l) => [l.oveAccountId as string, l.externalUserId]),
    );

    const result = new Map<string, string>();
    for (const [walletId, oveAccountId] of oveAccountIdByWalletId) {
      const externalUserId = externalUserIdByOveAccountId.get(oveAccountId);
      if (externalUserId) result.set(walletId, externalUserId);
    }
    return result;
  }
}

export function serializeServiceTransaction(
  t: {
    id: string;
    idempotencyKey: string;
    amount: bigint;
    transactionType: string;
    occurredAt: Date;
    status: string;
  },
  externalUserId: string | null,
) {
  return {
    id: t.id,
    idempotency_key: t.idempotencyKey,
    external_user_id: externalUserId,
    amount: t.amount.toString(),
    transaction_type: t.transactionType,
    rule_code: RULE_CODE_BY_TRANSACTION_TYPE[t.transactionType] ?? null,
    occurred_at: t.occurredAt.toISOString(),
    status: t.status,
  };
}
