import { Injectable } from "@nestjs/common";
import { AccountRepository } from "../accounts/account.repository";
import { AdminApprovalService } from "./admin-approval.service";

/**
 * アカウント統合 (指示書6章・13章)。残高・連携情報の移管を伴い取り消せないため、
 * 高額付与/高額減算と同様に二段階承認 (申請者と承認者の分離) の対象とする
 * (金額によらず常に承認が必要)。実際の統合処理は承認時に
 * `AdminApprovalService.approve()` から実行される。
 */
@Injectable()
export class AdminAccountMergeService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly approvals: AdminApprovalService,
  ) {}

  async requestMerge(params: {
    sourceAccountCode: string;
    targetAccountCode: string;
    reason: string;
    adminId: string;
  }) {
    const [source, target] = await Promise.all([
      this.accountRepository.findByAccountCodeOrThrow(params.sourceAccountCode),
      this.accountRepository.findByAccountCodeOrThrow(params.targetAccountCode),
    ]);

    const request = await this.approvals.requestAccountMerge({
      sourceAccountId: source.id,
      targetAccountId: target.id,
      sourceAccountCode: params.sourceAccountCode,
      targetAccountCode: params.targetAccountCode,
      reason: params.reason,
      requestedBy: params.adminId,
    });

    return { result: "PENDING_APPROVAL" as const, approvalRequestId: request.id };
  }
}
