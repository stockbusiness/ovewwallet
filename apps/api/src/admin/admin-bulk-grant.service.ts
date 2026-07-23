import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { AccountRepository } from "../accounts/account.repository";

interface CsvRow {
  externalUserId: string; // OVE account_code (例: OVE-ACC-00000001) を想定
  amount: number;
  transactionName: string;
  reason: string;
  eventId: string;
  idempotencyKey: string;
}

type RowClassification =
  | { status: "OK"; walletId: string }
  | { status: "DUPLICATE" }
  | { status: "UNKNOWN_USER" }
  | { status: "ERROR"; message: string };

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
 *
 * preview() はDBへ書き込まず (ウォレットへの反映は行わない)、集計結果のみ返す
 * "プレビュー表示" (指示書14章 手順7)。execute() が実際の付与を行う (手順9)。
 * 同じCSVをpreview→executeの順で渡すこと (rawなCSV行はDBへ保存していないため、
 * execute() は再度CSV全文を受け取る設計にしている)。
 */
@Injectable()
export class AdminBulkGrantService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
  ) {}

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

  /**
   * 実際にウォレットを更新せず、行ごとの分類のみ行う (読み取り専用)。
   * `seenKeysInBatch` は同一CSV内で idempotency_key が重複している行を検出するために使う
   * (execute中は実行直後に反映されるDB確認だけで検出できるが、preview中はDBへ何も
   * 書き込まないため、バッチ内の重複はこのSetで別途検出する必要がある)。
   */
  private async classifyRow(row: CsvRow, seenKeysInBatch: Set<string>): Promise<RowClassification> {
    if (!row.externalUserId || !Number.isInteger(row.amount) || row.amount <= 0 || !row.idempotencyKey) {
      return { status: "ERROR", message: "invalid row" };
    }

    if (seenKeysInBatch.has(row.idempotencyKey)) {
      return { status: "DUPLICATE" };
    }

    const existingTxn = await this.db.oveTransaction.findUnique({
      where: { idempotencyKey: row.idempotencyKey },
    });
    if (existingTxn) {
      return { status: "DUPLICATE" };
    }

    const account = await this.accountRepository.findByAccountCode(row.externalUserId);
    if (!account) {
      return { status: "UNKNOWN_USER" };
    }

    const wallet = await this.db.wallet.findUnique({ where: { oveAccountId: account.id } });
    if (!wallet) {
      return { status: "UNKNOWN_USER" };
    }

    return { status: "OK", walletId: wallet.id };
  }

  /** 指示書14章 手順1〜7: アップロード・検証・重複確認・プレビュー表示 (実行はしない)。 */
  async preview(csvContent: string, fileName: string, adminId: string): Promise<BulkGrantSummary> {
    const rows = this.parseCsv(csvContent);
    const results: BulkGrantRowResult[] = [];
    let successCount = 0;
    let duplicateCount = 0;
    let unknownUserCount = 0;
    let errorCount = 0;
    let totalAmountGranted = 0n;
    const seenKeysInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNumber = i + 2;
      const classification = await this.classifyRow(row, seenKeysInBatch);

      switch (classification.status) {
        case "OK":
          seenKeysInBatch.add(row.idempotencyKey);
          successCount++;
          totalAmountGranted += BigInt(row.amount);
          results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "SUCCESS" });
          break;
        case "DUPLICATE":
          duplicateCount++;
          results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "DUPLICATE" });
          break;
        case "UNKNOWN_USER":
          unknownUserCount++;
          results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "UNKNOWN_USER" });
          break;
        case "ERROR":
          errorCount++;
          results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "ERROR", message: classification.message });
          break;
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
        status: "PREVIEWED",
        createdBy: adminId,
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

  /**
   * 指示書14章 手順8〜10: 管理者確認後の実行・結果出力。
   * `batchId` は preview() が返したものを渡す (プレビュー→実行の対応関係を記録するため)。
   */
  async execute(csvContent: string, fileName: string, adminId: string, batchId?: string): Promise<BulkGrantSummary> {
    if (batchId) {
      const existingBatch = await this.db.bulkGrantBatch.findUnique({ where: { id: batchId } });
      if (!existingBatch) throw new NotFoundException("bulk grant batch (preview) not found");
      if (existingBatch.status !== "PREVIEWED") {
        throw new BadRequestException(`batch ${batchId} is not in PREVIEWED status (status=${existingBatch.status})`);
      }
    }

    const rows = this.parseCsv(csvContent);
    const results: BulkGrantRowResult[] = [];
    let successCount = 0;
    let duplicateCount = 0;
    let unknownUserCount = 0;
    let errorCount = 0;
    let totalAmountGranted = 0n;
    const seenKeysInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNumber = i + 2; // ヘッダ行を1行目として数える

      const classification = await this.classifyRow(row, seenKeysInBatch);
      if (classification.status === "DUPLICATE") {
        duplicateCount++;
        results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "DUPLICATE" });
        continue;
      }
      if (classification.status === "UNKNOWN_USER") {
        unknownUserCount++;
        results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "UNKNOWN_USER" });
        continue;
      }
      if (classification.status === "ERROR") {
        errorCount++;
        results.push({ row: rowNumber, externalUserId: row.externalUserId, status: "ERROR", message: classification.message });
        continue;
      }

      try {
        const transaction = await creditWallet(
          {
            walletId: classification.walletId,
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
        seenKeysInBatch.add(row.idempotencyKey);
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

    const batchData = {
      totalCount: rows.length,
      successCount,
      duplicateCount,
      unknownUserCount,
      errorCount,
      totalAmount: totalAmountGranted,
      status: "COMPLETED" as const,
      executedAt: new Date(),
    };

    const batch = batchId
      ? await this.db.bulkGrantBatch.update({ where: { id: batchId }, data: batchData })
      : await this.db.bulkGrantBatch.create({
          data: { id: generateId(), fileName, createdBy: adminId, ...batchData },
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
