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

/**
 * 千ノ国NFTマーケット契約v2指示書11章。202成功応答でも`reason:"common_user_pending"`
 * の場合は「配送処理が進んでいない」ことを意味し、`delivery_pending`へ進めてはいけない。
 */
export const MarketClaimConfirmResponseSchema = z.object({
  status: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * 千ノ国NFTマーケット契約v2指示書10.1章。新Market標準Error Envelope
 * (`{"error":{"code":"COMMON_USER_MISMATCH","message":"..."}}`)。同じHTTPステータスでも
 * revoked/common_user_mismatch/processing等を区別する必要があるため、ステータスコード
 * だけでなく本文もパースする。旧フラット形式(`{"code":"common_user_mismatch"}`)は
 * 本番未接続のため互換対応せず、新形式のみ受理する。
 */
export const MARKET_CLAIM_ERROR_CODE_VALUES = [
  "COMMON_USER_MISMATCH",
  "CLAIM_REVOKED",
  "CLAIM_EXPIRED",
  "CLAIM_TOKEN_INVALID",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
] as const;

export const MarketClaimErrorBodySchema = z.object({
  error: z
    .object({
      code: z.enum(MARKET_CLAIM_ERROR_CODE_VALUES).optional(),
      message: z.string().optional(),
    })
    .optional(),
});
