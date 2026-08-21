/**
 * PR-W3-a: entitlement.revokedのreason_codeを固定日本語文言へマッピングする。
 * 外部システム(Market)からの自由記述(revokeReason)はAPIから返らないため、ここでは扱わない。
 * 未知のコード(現時点の正式語彙はfull_refundのみ)は汎用文言へフォールバックする。
 */
export interface RevokeReasonDisplay {
  primary: string;
  description: string;
}

const REVOKE_REASON_LABELS: Record<string, RevokeReasonDisplay> = {
  full_refund: {
    primary: "返金により取消",
    description: "この受取権は全額返金により利用できません。",
  },
};

const GENERIC_REVOKED_LABEL: RevokeReasonDisplay = {
  primary: "利用停止 (取消済み)",
  description: "この受取権は利用できません。",
};

export function resolveRevokeReasonDisplay(
  reasonCode: string | null | undefined,
): RevokeReasonDisplay | null {
  if (!reasonCode) return null;
  return REVOKE_REASON_LABELS[reasonCode] ?? GENERIC_REVOKED_LABEL;
}
