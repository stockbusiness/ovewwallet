import { BadRequestException, Injectable } from "@nestjs/common";
import { CommonUserResolvedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { AccountRepository } from "../../accounts/account.repository";
import { CommonUserLinkingUseCase } from "../../accounts/common-user-linking.use-case";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/**
 * 契約4.1章の本人照合優先順位1.「指定済みcommon_user_idと正当なsystem link」に対応。
 * source_user_id (=ウォレット側のOveAccount.id、common-user-hub.client.tsが
 * external_user_idとして送っている値) でアカウントを特定し、未設定ならcommon_user_id
 * を保存する。既に別のcommon_user_idが設定済みの場合や、他アカウントに同じ値が
 * 既に設定されている場合は上書きせず競合として記録する (禁止事項3.2「未検証情報だけで
 * 自動的に人物統合しない」)。
 *
 * 追加整合性対策P0-1: 保存の排他制御・競合判定は`CommonUserLinkingUseCase`
 * (`CommonUserLinkingService`と共通) に委ね、`ove_accounts.common_user_id`の
 * UNIQUE制約により異なる2アカウントへの同時設定を防ぐ。
 */
@Injectable()
export class CommonUserResolvedHandler implements CommonEventHandler {
  readonly eventType = "common_user.resolved";
  readonly schema = CommonUserResolvedEventSchema;

  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly linking: CommonUserLinkingUseCase,
  ) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");
    const sourceUserId = body.source_user_id;
    if (!sourceUserId) return { action: "skipped", reason: "source_user_id not provided" };

    const account = await this.accountRepository.findById(sourceUserId);
    if (!account) return { action: "account_not_found", ove_account_id: sourceUserId };

    const result = await this.linking.link({
      accountId: account.id,
      commonUserId: body.common_user_id,
      actorType: "EXTERNAL_SERVICE",
      actorId: context.authenticatedSourceSystemKey,
      reasonContext: `event_id=${body.event_id}`,
    });

    if (result.action === "conflict_requires_review") {
      return { action: "conflict_ignored", ove_account_id: account.id };
    }
    if (result.action === "already_linked") {
      return { action: "already_linked", ove_account_id: account.id, common_user_id: body.common_user_id };
    }
    return { action: "linked", ove_account_id: account.id, common_user_id: body.common_user_id };
  }
}
