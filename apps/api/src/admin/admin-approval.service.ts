import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type Prisma, type PrismaClient } from "@ove/database";
import { creditWallet, debitWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { serializeTransaction } from "../wallets/wallets.service";

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

/**
 * 二段階承認の基本ワークフロー (指示書13章)。申請者と承認者は必ず別人でなければならない。
 * MVPでは高額付与・高額減算のみを対象とする (アカウント統合・オンチェーン移行・
 * 外部ウォレット変更・API上限変更は `approval_requests.request_type` の値だけ用意し、
 * ワークフロー自体は今後の拡張とする)。
 */
@Injectable()
export class AdminApprovalService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

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

  async approve(requestId: string, approverId: string) {
    const approvalRequest = await this.db.approvalRequest.findUnique({ where: { id: requestId } });
    if (!approvalRequest) throw new NotFoundException("approval request not found");
    if (approvalRequest.status !== "PENDING") {
      throw new ConflictException(`approval request ${requestId} is not PENDING (status=${approvalRequest.status})`);
    }
    if (approvalRequest.requestedBy === approverId) {
      throw new BadRequestException("the approver must be different from the requester (separation of duties)");
    }

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

    await this.db.approvalRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", approvedBy: approverId, decidedAt: new Date() },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: approverId,
        actionType: "APPROVAL_REQUEST_APPROVED",
        targetType: "approval_request",
        targetId: requestId,
        result: "SUCCESS",
        afterData: { transactionId: transaction.id },
      },
    });

    return serializeTransaction(transaction);
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
