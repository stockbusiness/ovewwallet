import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type Prisma, type PrismaClient } from "@ove/database";
import { creditWallet, debitWallet, mergeAccounts } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { serializeTransaction } from "../wallets/wallets.service";
import { AdminMigrationService } from "./admin-migration.service";

/**
 * 高額付与/高額減算の申請しきい値 (OVE)。この値以上の個別付与・減算は即時実行されず、
 * 二段階承認 (指示書13章) の申請として保留される。
 */
export const HIGH_VALUE_THRESHOLD = BigInt(process.env.HIGH_VALUE_THRESHOLD || "50000");

export interface HighValueGrantPayload {
  kind: "HIGH_VALUE_GRANT" | "HIGH_VALUE_DEDUCTION";
  walletId: string;
  amount: string; // bigint は JSON payload では文字列で保持する
  reason: string;
  idempotencyKey: string;
}

export interface AccountMergePayload {
  kind: "ACCOUNT_MERGE";
  sourceAccountId: string;
  targetAccountId: string;
  sourceAccountCode: string;
  targetAccountCode: string;
  reason: string;
  idempotencyKey: string;
}

export interface MigrationExecutionPayload {
  kind: "MIGRATION_EXECUTION";
  batchName: string;
  fileName: string;
  csvContent: string;
  reason: string;
}

/**
 * 二段階承認の基本ワークフロー (指示書13章)。申請者と承認者は必ず別人でなければならない。
 * 高額付与・高額減算 (金額しきい値以上のみ)、アカウント統合 (常に対象、金額に関わらず
 * 全件承認制)、既存ユーザー移行の実行 (常に対象、`docs/migration.md` 参照) を対象とする。
 * オンチェーン移行・外部ウォレット変更・API上限変更は `approval_requests.request_type`
 * の値だけ用意し、ワークフロー自体は今後の拡張とする。
 */
@Injectable()
export class AdminApprovalService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly migration: AdminMigrationService,
  ) {}

  async list(status?: string): Promise<unknown[]> {
    return this.db.approvalRequest.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { requestedAt: "desc" },
    });
  }

  async requestHighValueOperation(params: {
    kind: "HIGH_VALUE_GRANT" | "HIGH_VALUE_DEDUCTION";
    walletId: string;
    amount: bigint;
    reason: string;
    idempotencyKey: string;
    requestedBy: string;
  }) {
    const payload: HighValueGrantPayload = {
      kind: params.kind,
      walletId: params.walletId,
      amount: params.amount.toString(),
      reason: params.reason,
      idempotencyKey: params.idempotencyKey,
    };

    const approvalRequest = await this.db.approvalRequest.create({
      data: {
        id: generateId(),
        requestType: params.kind,
        status: "PENDING",
        requestedBy: params.requestedBy,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: params.requestedBy,
        actionType: "APPROVAL_REQUEST_CREATED",
        targetType: "approval_request",
        targetId: approvalRequest.id,
        result: "SUCCESS",
        reason: params.reason,
        afterData: { requestType: params.kind, amount: payload.amount, walletId: params.walletId },
      },
    });

    return approvalRequest;
  }

  /**
   * アカウント統合の申請を作成する。金額によらず常に承認が必要 (指示書6章・13章)。
   * 統合は残高・連携情報の移管を伴い取り消せないため、金額しきい値方式ではなく全件対象とする。
   */
  async requestAccountMerge(params: {
    sourceAccountId: string;
    targetAccountId: string;
    sourceAccountCode: string;
    targetAccountCode: string;
    reason: string;
    requestedBy: string;
  }) {
    if (params.sourceAccountId === params.targetAccountId) {
      throw new BadRequestException("source and target accounts must be different");
    }

    const payload: AccountMergePayload = {
      kind: "ACCOUNT_MERGE",
      sourceAccountId: params.sourceAccountId,
      targetAccountId: params.targetAccountId,
      sourceAccountCode: params.sourceAccountCode,
      targetAccountCode: params.targetAccountCode,
      reason: params.reason,
      idempotencyKey: `ACCOUNT_MERGE:${params.sourceAccountId}:${params.targetAccountId}`,
    };

    const approvalRequest = await this.db.approvalRequest.create({
      data: {
        id: generateId(),
        requestType: "ACCOUNT_MERGE",
        status: "PENDING",
        requestedBy: params.requestedBy,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: params.requestedBy,
        actionType: "APPROVAL_REQUEST_CREATED",
        targetType: "approval_request",
        targetId: approvalRequest.id,
        result: "SUCCESS",
        reason: params.reason,
        afterData: { requestType: "ACCOUNT_MERGE", sourceAccountCode: params.sourceAccountCode, targetAccountCode: params.targetAccountCode },
      },
    });

    return approvalRequest;
  }

  /**
   * 既存ユーザー移行の実行を申請する (指示書15章)。金額によらず常に承認が必要。
   * CSVの内容そのものを申請時点でpayloadに保存するため、承認者は実行前の内容を
   * そのまま確認できる (承認時に別内容へ差し替えられることはない)。
   */
  async requestMigrationExecution(params: {
    batchName: string;
    fileName: string;
    csvContent: string;
    reason: string;
    requestedBy: string;
  }): Promise<unknown> {
    const payload: MigrationExecutionPayload = {
      kind: "MIGRATION_EXECUTION",
      batchName: params.batchName,
      fileName: params.fileName,
      csvContent: params.csvContent,
      reason: params.reason,
    };

    const approvalRequest = await this.db.approvalRequest.create({
      data: {
        id: generateId(),
        requestType: "MIGRATION_EXECUTION",
        status: "PENDING",
        requestedBy: params.requestedBy,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: params.requestedBy,
        actionType: "APPROVAL_REQUEST_CREATED",
        targetType: "approval_request",
        targetId: approvalRequest.id,
        result: "SUCCESS",
        reason: params.reason,
        afterData: { requestType: "MIGRATION_EXECUTION", batchName: params.batchName, fileName: params.fileName },
      },
    });

    return approvalRequest;
  }

  async approve(requestId: string, approverId: string): Promise<unknown> {
    const approvalRequest = await this.db.approvalRequest.findUnique({ where: { id: requestId } });
    if (!approvalRequest) throw new NotFoundException("approval request not found");
    if (approvalRequest.status !== "PENDING") {
      throw new ConflictException(`approval request ${requestId} is not PENDING (status=${approvalRequest.status})`);
    }
    if (approvalRequest.requestedBy === approverId) {
      throw new BadRequestException("the approver must be different from the requester (separation of duties)");
    }

    // 2人の承認者が同じ申請をほぼ同時に承認しようとした場合、上のstatus===PENDINGの確認
    // だけでは両方が通過してしまい (TOCTOU)、資金移動や移行実行が二重に走りうる。
    // status: "PENDING" を条件に含めた条件付き更新で先に承認済みへ確定させ、
    // 影響行数が0件なら他方が先に処理を終えたということなので競合として弾く。
    const claimed = await this.db.approvalRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "APPROVED", approvedBy: approverId, decidedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException(`approval request ${requestId} was already decided by another approver`);
    }

    let execution: { resultPayload: unknown; auditAfterData: Record<string, unknown> };

    try {
      execution = await this.executeApprovedRequest(approvalRequest, approverId, requestId);
    } catch (err) {
      // 実行に失敗した場合はPENDINGへ戻し、再承認によるやり直しを可能にする
      // (先に確定させたAPPROVEDのままだと、実際には何も実行されていないのに
      // 承認済みとして扱われてしまうため)。
      await this.db.approvalRequest.update({
        where: { id: requestId },
        data: { status: "PENDING", approvedBy: null, decidedAt: null },
      });
      throw err;
    }

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: approverId,
        actionType: "APPROVAL_REQUEST_APPROVED",
        targetType: "approval_request",
        targetId: requestId,
        result: "SUCCESS",
        afterData: execution.auditAfterData as unknown as Prisma.InputJsonValue,
      },
    });

    return execution.resultPayload;
  }

  private async executeApprovedRequest(
    approvalRequest: { requestType: string; payload: unknown; requestedBy: string },
    approverId: string,
    requestId: string,
  ): Promise<{ resultPayload: unknown; auditAfterData: Record<string, unknown> }> {
    let resultPayload: unknown;
    let auditAfterData: Record<string, unknown>;

    if (approvalRequest.requestType === "ACCOUNT_MERGE") {
      const payload = approvalRequest.payload as unknown as AccountMergePayload;
      const mergeResult = await mergeAccounts(
        {
          sourceAccountId: payload.sourceAccountId,
          targetAccountId: payload.targetAccountId,
          reason: payload.reason,
          idempotencyKey: payload.idempotencyKey,
          createdByType: "ADMIN",
          createdById: approverId,
        },
        this.db,
      );
      resultPayload = mergeResult;
      auditAfterData = { transferredAmount: mergeResult.transferredAmount };
    } else if (approvalRequest.requestType === "MIGRATION_EXECUTION") {
      const payload = approvalRequest.payload as unknown as MigrationExecutionPayload;
      // 実行者 = 申請者 (移行を依頼した管理者)、検証者 = 承認者 (内容を確認し実行を許可した管理者)。
      const summary = await this.migration.execute(
        payload.csvContent,
        payload.fileName,
        payload.batchName,
        approvalRequest.requestedBy,
        approverId,
      );
      resultPayload = summary;
      auditAfterData = {
        batchId: summary.batchId,
        successCount: summary.successCount,
        reviewingCount: summary.reviewingCount,
        errorCount: summary.errorCount,
      };
    } else {
      const payload = approvalRequest.payload as unknown as HighValueGrantPayload;
      const amount = BigInt(payload.amount);

      const transaction =
        payload.kind === "HIGH_VALUE_GRANT"
          ? await creditWallet(
              {
                walletId: payload.walletId,
                amount,
                transactionType: "ADMIN_GRANT",
                idempotencyKey: payload.idempotencyKey,
                displayName: "管理者による高額付与 (承認済み)",
                description: payload.reason,
                createdByType: "ADMIN",
                createdById: approverId,
                metadata: { approvalRequestId: requestId, requestedBy: approvalRequest.requestedBy },
              },
              this.db,
            )
          : await debitWallet(
              {
                walletId: payload.walletId,
                amount,
                transactionType: "ADMIN_DEDUCTION",
                idempotencyKey: payload.idempotencyKey,
                displayName: "管理者による高額減算 (承認済み)",
                description: payload.reason,
                createdByType: "ADMIN",
                createdById: approverId,
                metadata: { approvalRequestId: requestId, requestedBy: approvalRequest.requestedBy },
              },
              this.db,
            );
      resultPayload = serializeTransaction(transaction);
      auditAfterData = { transactionId: transaction.id };
    }

    return { resultPayload, auditAfterData };
  }

  async reject(requestId: string, approverId: string, reason: string): Promise<unknown> {
    const approvalRequest = await this.db.approvalRequest.findUnique({ where: { id: requestId } });
    if (!approvalRequest) throw new NotFoundException("approval request not found");
    if (approvalRequest.status !== "PENDING") {
      throw new ConflictException(`approval request ${requestId} is not PENDING (status=${approvalRequest.status})`);
    }
    if (approvalRequest.requestedBy === approverId) {
      throw new BadRequestException("the approver must be different from the requester (separation of duties)");
    }

    const updated = await this.db.approvalRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", approvedBy: approverId, decidedAt: new Date(), rejectionReason: reason },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: approverId,
        actionType: "APPROVAL_REQUEST_REJECTED",
        targetType: "approval_request",
        targetId: requestId,
        result: "SUCCESS",
        reason,
      },
    });

    return updated;
  }
}
