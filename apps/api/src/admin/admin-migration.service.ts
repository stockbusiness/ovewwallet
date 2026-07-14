import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { AccountsService } from "../accounts/accounts.service";

interface MigrationRow {
  oldUserId: string;
  /** 空欄 = 残高不明。数値でない/負数は不正行として扱う。 */
  oldBalanceRaw: string;
}

export interface MigrationRowResult {
  row: number;
  oldUserId: string;
  status: "SUCCESS" | "REVIEWING" | "ERROR";
  message?: string;
}

export interface MigrationSummary {
  batchId: string;
  totalCount: number;
  successCount: number;
  reviewingCount: number;
  errorCount: number;
  results: MigrationRowResult[];
}

/**
 * 既存ユーザー移行 (指示書15章)。CSV形式: old_user_id,old_balance
 * old_balance が空欄の行は「残高不明」として扱い、推定値を入れずアカウントを
 * REVIEWING状態にする。旧ユーザーIDは account_identities
 * (provider: "LEGACY_SYSTEM") でOVEアカウントと紐付ける。
 */
@Injectable()
export class AdminMigrationService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accounts: AccountsService,
  ) {}

  private parseCsv(content: string): MigrationRow[] {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return [];

    const [, ...dataLines] = lines; // ヘッダ行を読み飛ばす
    return dataLines.map((line) => {
      const [oldUserId, oldBalanceRaw] = line.split(",").map((v) => v.trim());
      return { oldUserId: oldUserId ?? "", oldBalanceRaw: oldBalanceRaw ?? "" };
    });
  }

  async execute(
    csvContent: string,
    fileName: string,
    batchName: string,
    executedBy: string,
    verifiedBy: string | undefined,
  ): Promise<MigrationSummary> {
    const sourceDataHash = createHash("sha256").update(csvContent).digest("hex");
    const rows = this.parseCsv(csvContent);

    const batch = await this.db.migrationBatch.create({
      data: {
        id: generateId(),
        batchName,
        sourceFileName: fileName,
        sourceDataHash,
        executedBy,
        verifiedBy,
        status: "RUNNING",
        totalCount: rows.length,
      },
    });

    const results: MigrationRowResult[] = [];
    let successCount = 0;
    let reviewingCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNumber = i + 2;

      if (!row.oldUserId) {
        errorCount++;
        const message = "old_user_id is required";
        errors.push(`row ${rowNumber}: ${message}`);
        results.push({ row: rowNumber, oldUserId: row.oldUserId, status: "ERROR", message });
        continue;
      }

      try {
        const account = await this.accounts.findOrCreateByIdentity({
          identityType: "LEGACY_SYSTEM",
          provider: "LEGACY_SYSTEM",
          providerSubject: row.oldUserId,
        });

        if (!row.oldBalanceRaw) {
          // 残高不明: 推定値を入れず、確認が必要な状態にする。
          await this.db.oveAccount.update({ where: { id: account.id }, data: { status: "REVIEWING" } });
          reviewingCount++;
          results.push({ row: rowNumber, oldUserId: row.oldUserId, status: "REVIEWING" });
          continue;
        }

        const oldBalance = Number(row.oldBalanceRaw);
        if (!Number.isInteger(oldBalance) || oldBalance < 0) {
          throw new Error(`invalid old_balance: ${row.oldBalanceRaw}`);
        }

        if (oldBalance > 0) {
          const wallet = await this.db.wallet.findUniqueOrThrow({ where: { oveAccountId: account.id } });
          // idempotencyKey は batch.id ではなく sourceDataHash (CSV内容のハッシュ) を使う。
          // batch.id は実行のたびに新規生成されるため、同じCSVを再実行した際に
          // idempotencyKeyまで毎回変わってしまうと二重付与を防げなくなる
          // (CSV一括付与の「同じCSVを再実行しても二重付与されない」という要件と同様)。
          await creditWallet(
            {
              walletId: wallet.id,
              amount: oldBalance,
              transactionType: "OPENING_BALANCE",
              idempotencyKey: `OPENING_BALANCE:${sourceDataHash}:${row.oldUserId}`,
              displayName: "旧システムからの移行残高",
              sourceReferenceId: row.oldUserId,
              createdByType: "ADMIN",
              createdById: executedBy,
              metadata: { migrationBatchId: batch.id, oldUserId: row.oldUserId },
            },
            this.db,
          );
        }

        successCount++;
        results.push({ row: rowNumber, oldUserId: row.oldUserId, status: "SUCCESS" });
      } catch (error) {
        errorCount++;
        const message = error instanceof Error ? error.message : "unknown error";
        errors.push(`row ${rowNumber}: ${message}`);
        results.push({ row: rowNumber, oldUserId: row.oldUserId, status: "ERROR", message });
      }
    }

    await this.db.migrationBatch.update({
      where: { id: batch.id },
      data: {
        status: "COMPLETED",
        successCount,
        reviewingCount,
        errorDetail: errors.length > 0 ? errors.join("\n") : null,
        executedAt: new Date(),
      },
    });

    return {
      batchId: batch.id,
      totalCount: rows.length,
      successCount,
      reviewingCount,
      errorCount,
      results,
    };
  }
}
