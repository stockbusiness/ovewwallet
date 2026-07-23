import { z } from "zod";

/**
 * 代理店システム(sengoku-ai.com)からのレスポンスの型検証。フィールドの必須/任意は
 * 実際のレスポンス例に基づく最小限の制約とし、`ok`と成否詳細の整合(例:
 * `ok:true`なのに`common_user_id`が無い)はスキーマではなくAdapter側で判定する
 * (Zodは「JSONとして期待する形か」の基礎検証のみを担当する)。
 */
export const ResolveCommonUserResponseSchema = z.object({
  ok: z.boolean(),
  common_user_id: z.string().optional(),
  created: z.boolean().optional(),
  matched_by: z.string().optional(),
});

export const CaptureReferralResponseSchema = z.object({
  referral_session_key: z.string().optional(),
  canonical_referral_token: z.string().optional(),
  agency_id: z.string().nullable().optional(),
  status: z.string().optional(),
  expires_at: z.string().nullable().optional(),
});

export const ConfirmReferralResponseSchema = z.object({
  status: z.string().optional(),
});
