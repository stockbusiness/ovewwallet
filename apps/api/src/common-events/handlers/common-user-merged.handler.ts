import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@ove/database";
import { CommonUserMergedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { PRISMA } from "../../common/prisma.module";
import { AdminApprovalService } from "../../admin/admin-approval.service";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/**
 * common_user.merged。統合先(新common_user_id)・統合元(旧common_user_id、
 * リファクタリング指示書 Phase 5により正式フィールド`previous_common_user_id`を優先し、
 * 未指定の送信元向けに`metadata.previous_common_user_id`を後方互換fallbackとして
 * 参照する) の両方に既存Wallet accountが存在する場合、指示書5.3章
 * 「両方にWallet accountが存在する場合は自動統合しない」に従い
 * 自動マージせず、既存の二段階承認フロー (`AdminApprovalService.requestAccountMerge`)
 * へ申請するだけにとどめる。申請者はシステムsentinel値とし、実際の統合実行は
 * 人間の管理者が承認して初めて行われる (`approval_requests.requested_by`は
 * 外部キーではない文字列のため、実在の管理者IDと衝突しない値を使う)。3件以上存在する
 * 場合も全件をレビュー対象とし、どの2件を統合するか自動判断しない。
 */
@Injectable()
export class CommonUserMergedHandler implements CommonEventHandler {
  readonly eventType = "common_user.merged";
  readonly schema = CommonUserMergedEventSchema;

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly approvals: AdminApprovalService,
  ) {}

  async handle(_context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");
    // 正式フィールドを優先し、未指定の送信元向けにmetadataを後方互換fallbackとして扱う。
    const previousCommonUserId =
      body.previous_common_user_id ??
      (body.metadata as Record<string, unknown> | null | undefined)?.["previous_common_user_id"];
    if (typeof previousCommonUserId !== "string" || !previousCommonUserId) {
      return { action: "skipped", reason: "previous_common_user_id not provided" };
    }

    const accounts = await this.db.oveAccount.findMany({
      where: { commonUserId: { in: [body.common_user_id, previousCommonUserId] } },
    });

    if (accounts.length === 0) {
      return { action: "no_local_accounts" };
    }

    if (accounts.length === 1) {
      const account = accounts[0]!;
      if (account.commonUserId !== body.common_user_id) {
        await this.db.oveAccount.update({
          where: { id: account.id },
          data: { commonUserId: body.common_user_id, commonUserLinkedAt: new Date() },
        });
      }
      return { action: "relinked", ove_account_id: account.id };
    }

    // 2件以上 (3件以上も含む) の既存アカウントが対象common_user_idに紐づいていた場合。
    // 統合先はcommon_user_id (新) に既に紐づく方を優先するが、3件以上ある場合は
    // どの2件を統合すべきか自動判断せず、全件を承認申請の対象として明示する。
    const target = accounts.find((a) => a.commonUserId === body.common_user_id) ?? accounts[0]!;
    const others = accounts.filter((a) => a.id !== target.id);
    if (others.length === 0) return { action: "no_merge_needed", ove_account_id: target.id };

    const requestIds: string[] = [];
    for (const source of others) {
      const requestedBy = `system:common_user.merged:${body.event_id}:${source.id}`;
      const request = await this.approvals.requestAccountMerge({
        sourceAccountId: source.id,
        targetAccountId: target.id,
        sourceAccountCode: source.accountCode,
        targetAccountCode: target.accountCode,
        reason: `common_user.merged (event_id=${body.event_id}) 受信によるアカウント統合申請 (対象${accounts.length}件)`,
        requestedBy,
      });
      requestIds.push(request.id);
    }

    return {
      action: "approval_requested",
      approval_request_ids: requestIds,
      target_ove_account_id: target.id,
      source_ove_account_ids: others.map((a) => a.id),
    };
  }
}
