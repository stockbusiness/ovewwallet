import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { generateId, type Prisma, type PrismaClient } from "@ove/database";
import { CustomerAssignmentChangedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { AccountRepository } from "../../accounts/account.repository";
import { PRISMA } from "../../common/prisma.module";
import { AgencyAssignmentRepository, type UpdateAgencyAssignmentParams } from "../agency-assignment.repository";
import { CommonEventAccountResolver } from "../common-event-account-resolver";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/**
 * 契約4.2章のassigned_agency_id (現在の顧客担当代理店、変更可能) を更新する。
 * registration_referrer_agency_idは初回のみ設定しロックする (一度設定した値は
 * イベントからの上書きを許可しない)。変更履歴は別テーブルを持たず、既存のAuditLog
 * のbefore/afterで代替する (指示書5.4章「監査・報酬照合のため保持する」)。
 */
@Injectable()
export class CustomerAssignmentChangedHandler implements CommonEventHandler {
  readonly eventType = "customer.assignment.changed";
  readonly schema = CustomerAssignmentChangedEventSchema;

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountResolver: CommonEventAccountResolver,
    private readonly agencyAssignments: AgencyAssignmentRepository,
    private readonly accountRepository: AccountRepository,
  ) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");

    // 現在値に依存しない、明らかなno-op (どちらのフィールドもイベントに無い) だけは
    // トランザクションを開かずに即座に返す。実際の判定 (特にregistrationReferrerAgencyId
    // の「初回のみ設定」) は現在値に依存するため、必ずロック後の再取得で行う。
    if (!body.assigned_agency_id && !body.registration_referrer_agency_id) {
      return { action: "no_change" };
    }

    const resolved = await this.accountResolver.resolveByCommonUserId(
      body.common_user_id,
      "CUSTOMER_ASSIGNMENT_CHANGED",
      context.authenticatedSourceSystemKey,
    );
    if (resolved.status === "not_found") return { action: "account_not_found" };
    if (resolved.status === "conflict") {
      return { action: "conflict_requires_review", account_ids: resolved.accountIds };
    }
    const accountId = resolved.account.id;

    // 追加整合性対策P0-2: registrationReferrerAgencyIdが未設定かどうかの判定を
    // トランザクション外の (古くなりうる) 読み取りに基づいて行うと、異なる紹介元代理店を
    // 名乗る2つのイベントが同時に来た場合、両方とも「未設定」と判断して後着が先着を
    // 上書きしうる (TOCTOU)。行をFOR UPDATEでロックしてから最新状態を再取得し、
    // その値だけを判定に使う。
    return this.db.$transaction(async (tx) => {
      await this.accountRepository.lockById(accountId, tx);
      const account = await this.accountRepository.findById(accountId, tx);
      if (!account) return { action: "account_not_found" };

      const data: UpdateAgencyAssignmentParams = {};
      if (body.assigned_agency_id && body.assigned_agency_id !== account.assignedAgencyId) {
        data.assignedAgencyId = body.assigned_agency_id;
      }
      if (body.registration_referrer_agency_id && !account.registrationReferrerAgencyId) {
        data.registrationReferrerAgencyId = body.registration_referrer_agency_id;
      }

      if (Object.keys(data).length === 0) {
        return { action: "no_change", ove_account_id: account.id };
      }

      // 更新とAuditLog作成は同一トランザクションで確定する。片方だけ成功すると、
      // 再送時に「AuditLog記録前に既にassignedAgencyIdが最新値と一致 (=no_change)」
      // と誤判定され、監査ログが永久に欠落しうるため。
      await this.agencyAssignments.updateAssignment(account.id, data, tx);
      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "EXTERNAL_SERVICE",
          actorId: context.authenticatedSourceSystemKey,
          actionType: "CUSTOMER_ASSIGNMENT_CHANGED",
          targetType: "ove_account",
          targetId: account.id,
          result: "SUCCESS",
          beforeData: {
            assignedAgencyId: account.assignedAgencyId,
            registrationReferrerAgencyId: account.registrationReferrerAgencyId,
          },
          afterData: data as unknown as Prisma.InputJsonValue,
          reason: `event_id=${body.event_id}`,
        },
      });

      return { action: "updated", ove_account_id: account.id };
    });
  }
}
