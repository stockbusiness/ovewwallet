import { Inject, Injectable } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";

interface CsvRow {
  externalUserId: string; // OVE account_code (例: OVE-ACC-00000001) を想定
  amount: number;
  transactionName: string;
  reason: string;
  eventId: string;
  idempotencyKey: string;
}

export interface BulkGrantRowResult {
  row: number;
  externalUserId: string;
  status: "SUCCESS" | "DUPLICATE" | "UNKNOWN_USER" | "ERROR";
  message?: string;
}

export interface BulkGrantSummary {
  batchId: string;
  totalCount: number;
  successCount: number;
  duplicateCount: number;
  unknownUserCount: number;
  errorCount: number;
  totalAmountGranted: string;
  results: BulkGrantRowResult[];
}

/**
 * CSV一括付与 (指示書14章)。CSV形式:
 * external_user_id,amount,transaction_name,reason,event_id,idempotency_key
 * external_user_id は OVE の account_code を指す (管理者が把握済みのOVEアカウントへの付与を想定)。
 * 同じCSVを再実行しても idempotency_key の一意制約により二重付与されない。
 */
@Injectable()
export class AdminBulkGrantService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private parseCsv(content: string): CsvRow[] {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return [];

    const [, ...dataLines] = lines; // 1行目はヘッダとして読み飛ばす
    return dataLines.map((line) => {
      const [externalUserId, amount, transactionName, reason, eventId, idempotencyKey] = line
        .split(",")
        .map((v) => v.trim());
      return {
        externalUserId: externalUserId ?? "",
        amount: Number(amount),
        transactionName: transactionName ?? "CSV一括付与",
        reason: reason ?? "",
        eventId: eventId ?? "",
        idempotencyKey: idempotencyKey ?? "",
      };
    });
  }

  async execute(csvContent: string, fileName: string, adminId: string): Promise<BulkGrantSummary> {
    const rows = this.parseCsv(csvContent);
    const results: BulkGrantRowResult[] = [];
    let successCount = 0;
    let duplicateCount = 0;
    let unknownUserCount = 0;
    let errorCount = 0;
    let totalAmountGranted = 0n;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNumber = i + 2; // ヘッダ行を1行目として数える

      if (!row.externalUserId || !Number.isInteger(row.amount) || row.amount <= 0 || !row.idempotencyKey) {
        results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "ERROR", message: "invalid row" });
        errorCount++;
        continue;
      }

      const existingTxn = await this.db.oveTransaction.findUnique({
        where: { idempotencyKey: row.idempotencyKey },
      });
      if (existingTxn) {
        results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "DUPLICATE" });
        duplicateCount++;
        continue;
      }

      const account = await this.db.oveAccount.findUnique({ where: { accountCode: row.externalUserId } });
      if (!account) {
        results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "UNKNOWN_USER" });
        unknownUserCount++;
        continue;
      }

      try {
        const wallet = await this.db.wallet.findUniqueOrThrow({ where: { oveAccountId: account.id } });
        const transaction = await creditWallet(
          {
            walletId: wallet.id,
            amount: row.amount,
            transactionType: "CAMPAIGN_REWARD",
            idempotencyKey: row.idempotencyKey,
            displayName: row.transactionName,
            description: row.reason,
            sourceReferenceId: row.eventId || undefined,
            createdByType: "ADMIN",
            createdById: adminId,
          },
          this.db,
        );
        totalAmountGranted += transaction.amount;
        results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "SUCCESS" });
        successCount++;
      } catch (error) {
        results.push({
          row: rowNumber,
          externalUserId: row.externalUserId,
          status: "ERROR",
          message: error instanceof Error ? error.message : "unknown error",
        });
        errorCount++;
      }
    }

    const batch = await this.db.bulkGrantBatch.create({
      data: {
        id: generateId(),
        fileName,
        totalCount: rows.length,
        successCount,
        duplicateCount,
        unknownUserCount,
        errorCount,
        totalAmount: totalAmountGranted,
        status: "COMPLETED",
        createdBy: adminId,
        executedAt: new Date(),
      },
    });

    return {
      batchId: batch.id,
      totalCount: rows.length,
      successCount,
      duplicateCount,
      unknownUserCount,
      errorCount,
      totalAmountGranted: totalAmountGranted.toString(),
      results,
    };
  }
}
