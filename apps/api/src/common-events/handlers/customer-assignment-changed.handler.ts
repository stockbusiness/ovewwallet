import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { generateId, type Prisma, type PrismaClient } from "@ove/database";
import { CustomerAssignmentChangedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { PRISMA } from "../../common/prisma.module";
import { CommonEventAccountResolver } from "../common-event-account-resolver";
import { AgencyAssignmentRepository, type UpdateAgencyAssignmentParams } from "../agency-assignment.repository";
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
  ) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");

    const resolved = await this.accountResolver.resolveByCommonUserId(
      body.common_user_id,
      "CUSTOMER_ASSIGNMENT_CHANGED",
      context.authenticatedSourceSystemKey,
    );
    if (resolved.status === "not_found") return { action: "account_not_found" };
    if (resolved.status === "conflict") {
      return { action: "conflict_requires_review", account_ids: resolved.accountIds };
    }
    const account = resolved.account;

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

    await this.agencyAssignments.updateAssignment(account.id, data);
    await this.db.auditLog.create({
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
  }
}
