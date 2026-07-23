import type { Prisma } from "@ove/database";
import type { CommonEventBody } from "@ove/shared-types";

/**
 * `reward.reversed`受信時、原取引の認証済み送信元 (sourceService) と一致しない場合でも
 * 取消を許可するシステム (中央オーケストレーター等) のsystem_key一覧
 * (次期改修指示書P0-4「中央オーケストレーターだけが取消可能な場合は明示的にallowlist化」)。
 * カンマ区切り、既定は空 (=いかなる代理取消も許可しない、最も安全な既定値)。
 */
export function getReversalOrchestratorSystemKeys(): Set<string> {
  return new Set(
    (process.env.COMMON_EVENT_REVERSAL_ORCHESTRATOR_SYSTEM_KEYS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** 指示書5.4章の代理店4役等を、台帳(ove_transactions.metadata)へ構造化保存する。 */
export function buildAgencyMetadata(body: CommonEventBody, authenticatedSourceSystemKey: string): Prisma.InputJsonValue {
  return {
    eventId: body.event_id,
    eventType: body.event_type,
    registrationReferrerAgencyId: body.registration_referrer_agency_id ?? null,
    assignedAgencyId: body.assigned_agency_id ?? null,
    salesAgentId: body.sales_agent_id ?? null,
    closingAgentId: body.closing_agent_id ?? null,
    orderId: body.order_id ?? null,
    orderItemId: body.order_item_id ?? null,
    sourceSystemKey: authenticatedSourceSystemKey,
    referralSessionKey: body.referral_session_key ?? null,
    productCode: body.product_code ?? null,
    entitlementId: body.entitlement_id ?? null,
    correlationId: body.correlation_id ?? null,
  };
}
