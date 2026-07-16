import { z } from "zod";
import { ServiceCode, TransactionType } from "./enums";

const serviceCodeValues = Object.values(ServiceCode) as [string, ...string[]];
const transactionTypeValues = Object.values(TransactionType) as [string, ...string[]];

/** POST /api/v1/rewards/grant */
export const RewardGrantRequestSchema = z.object({
  service_code: z.enum(serviceCodeValues),
  external_user_id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(100),
  event_id: z.string().min(1).max(255),
  amount: z.number().int().positive(),
  transaction_type: z.enum(transactionTypeValues).default(TransactionType.EVENT_REWARD),
  display_name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  idempotency_key: z.string().min(1).max(255),
});
export type RewardGrantRequest = z.infer<typeof RewardGrantRequestSchema>;

/** POST /api/v1/transactions/debit */
export const DebitRequestSchema = z.object({
  service_code: z.enum(serviceCodeValues),
  external_user_id: z.string().min(1).max(255),
  amount: z.number().int().positive(),
  transaction_type: z.enum(transactionTypeValues).default(TransactionType.ITEM_EXCHANGE),
  display_name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  source_reference_id: z.string().max(255).optional(),
  idempotency_key: z.string().min(1).max(255),
});
export type DebitRequest = z.infer<typeof DebitRequestSchema>;

/** POST /api/v1/transactions/{transactionId}/reverse */
export const ReverseRequestSchema = z.object({
  reason: z.string().min(1).max(1000),
  idempotency_key: z.string().min(1).max(255),
});
export type ReverseRequest = z.infer<typeof ReverseRequestSchema>;

export const TransactionResponseSchema = z.object({
  id: z.string(),
  transaction_code: z.string(),
  wallet_id: z.string(),
  transaction_type: z.string(),
  direction: z.string(),
  amount: z.number(),
  status: z.string(),
  balance_before: z.number(),
  balance_after: z.number(),
  display_name: z.string(),
  description: z.string().nullable(),
  occurred_at: z.string(),
  completed_at: z.string().nullable(),
});
export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;

/**
 * POST /api/integrations/agencies (戦国経済圏代理店システム外部連携API仕様書
 * v3.6.71 7章)。sengoku-ai.comから代理店情報の同期を受信する。将来の
 * フィールド追加(仕様書付則)に備え、未知のフィールドは無視せず素通りさせる
 * (.passthrough())。connection_test/dry_runの場合はexternal_id以外は
 * 送られないことがあるため、external_id以外は全て任意とする。
 */
export const AgencySyncRequestSchema = z
  .object({
    event: z.string().max(50).optional(),
    dry_run: z.boolean().optional(),
    source: z.string().max(100).optional(),
    external_id: z.string().min(1).max(255),
    parent_external_id: z.string().max(255).nullable().optional(),
    common_user_id: z.string().max(255).nullable().optional(),
    referral_token: z.string().max(255).nullable().optional(),
    name: z.string().max(255).nullable().optional(),
    contact_name: z.string().max(255).nullable().optional(),
    contact_email: z.string().email().max(255).nullable().optional(),
    login_email: z.string().email().max(255).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    role: z.string().max(50).nullable().optional(),
    role_label: z.string().max(100).nullable().optional(),
    status: z.string().max(50).nullable().optional(),
  })
  .passthrough();
export type AgencySyncRequest = z.infer<typeof AgencySyncRequestSchema>;

/** POST /api/v1/auth/sso/agency (仕様書12章)。sengoku-ai.com発行のSSO用JWTでログインする。 */
export const AgencySsoLoginRequestSchema = z.object({
  token: z.string().min(1),
  termsAccepted: z.boolean().optional(),
});
export type AgencySsoLoginRequest = z.infer<typeof AgencySsoLoginRequestSchema>;

export const BalanceResponseSchema = z.object({
  ove_account_id: z.string(),
  wallet_id: z.string(),
  wallet_code: z.string(),
  status: z.string(),
  available_balance: z.number(),
  pending_balance: z.number(),
  held_balance: z.number(),
  lifetime_credited: z.number(),
  lifetime_debited: z.number(),
});
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;
