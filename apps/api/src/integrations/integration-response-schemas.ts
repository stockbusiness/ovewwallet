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

/**
 * NFTカードClaim導線実装指示書。戦国マーケットClaim APIのレスポンス。
 * 2xxで返る状態はマーケット側が管理するライフサイクルであり、ウォレット側では
 * キャッシュ・所有しない (毎回GETで問い合わせる)。
 */
export const MARKET_CLAIM_STATUS_VALUES = ["PENDING", "DELIVERY_PENDING", "DELIVERED", "EXPIRED", "REVOKED"] as const;

export const MarketClaimStatusResponseSchema = z.object({
  status: z.enum(MARKET_CLAIM_STATUS_VALUES),
  card_name: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
});

export const MarketClaimConfirmResponseSchema = z.object({
  status: z.string().optional(),
});

/**
 * 409応答本文の機械可読な種別。同じHTTPステータスでも
 * revoked/common_user_mismatch/processingを区別する必要があるため
 * (指示書7章「エラー分類」)、ステータスコードだけでなく本文もパースする。
 */
export const MarketClaimErrorBodySchema = z.object({
  code: z.enum(["revoked", "common_user_mismatch", "processing", "not_found", "expired"]).optional(),
  message: z.string().optional(),
});
