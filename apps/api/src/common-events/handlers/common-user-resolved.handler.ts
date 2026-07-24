import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { CommonUserResolvedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { PRISMA } from "../../common/prisma.module";
import { AccountRepository } from "../../accounts/account.repository";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/**
 * 契約4.1章の本人照合優先順位1.「指定済みcommon_user_idと正当なsystem link」に対応。
 * source_user_id (=ウォレット側のOveAccount.id、common-user-hub.client.tsが
 * external_user_idとして送っている値) でアカウントを特定し、未設定ならcommon_user_id
 * を保存する。既に別のcommon_user_idが設定済みの場合は上書きせず競合として記録する
 * (禁止事項3.2「未検証情報だけで自動的に人物統合しない」)。
 */
@Injectable()
export class CommonUserResolvedHandler implements CommonEventHandler {
  readonly eventType = "common_user.resolved";
  readonly schema = CommonUserResolvedEventSchema;

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
  ) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");
    const sourceUserId = body.source_user_id;
    if (!sourceUserId) return { action: "skipped", reason: "source_user_id not provided" };

    const account = await this.accountRepository.findById(sourceUserId);
    if (!account) return { action: "account_not_found", ove_account_id: sourceUserId };

    if (account.commonUserId === body.common_user_id) {
      return { action: "already_linked", ove_account_id: account.id, common_user_id: body.common_user_id };
    }

    if (account.commonUserId && account.commonUserId !== body.common_user_id) {
      await this.db.auditLog.create({
        data: {
          id: generateId(),
          actorType: "EXTERNAL_SERVICE",
          actorId: context.authenticatedSourceSystemKey,
          actionType: "COMMON_USER_RESOLVED_CONFLICT",
          targetType: "ove_account",
          targetId: account.id,
          result: "FAILURE",
          reason: "既存のcommon_user_idと異なる値を受信 (自動上書きしない)",
          beforeData: { commonUserId: account.commonUserId },
          afterData: { rejectedCommonUserId: body.common_user_id },
        },
      });
      return { action: "conflict_ignored", ove_account_id: account.id };
    }

    // モジュール化後レビュー対応 P1-2: common_user_idにUNIQUE制約が無いため、他アカウントに
    // 同じ値が既に設定されていないかを保存前に必ず確認する (自動で複数アカウントへ
    // 同じcommon_user_idを設定しない)。
    const conflictingAccounts = await this.accountRepository.findConflictingCommonUserLinks(
      body.common_user_id,
      account.id,
    );
    if (conflictingAccounts.length > 0) {
      await this.db.auditLog.create({
        data: {
          id: generateId(),
          actorType: "EXTERNAL_SERVICE",
          actorId: context.authenticatedSourceSystemKey,
          actionType: "COMMON_USER_RESOLVED_CONFLICT",
          targetType: "ove_account",
          targetId: account.id,
          result: "FAILURE",
          reason: `common_user_id "${body.common_user_id}" は既に他のOVEアカウントに設定済みのため自動設定しない`,
          afterData: {
            rejectedCommonUserId: body.common_user_id,
            conflictingAccountIds: conflictingAccounts.map((a) => a.id),
          },
        },
      });
      return { action: "conflict_ignored", ove_account_id: account.id };
    }

    await this.accountRepository.linkCommonUser(account.id, body.common_user_id);
    return { action: "linked", ove_account_id: account.id, common_user_id: body.common_user_id };
  }
}
