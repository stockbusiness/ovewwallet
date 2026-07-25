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
 * POST /api/integrations/agencies (外部開発者向け連携ガイド v3.6.78-draft 8章・11章)。
 * sengoku-ai.comから2種類のイベントを受信する:
 * (1) 代理店レコードの同期 (admin_created/admin_updated/role_updated/approved/
 *     promoted/deactivated/deleted等、`external_id`で識別)
 * (2) 共通顧客HUBイベント (lead_created/common_user.merged/
 *     common_user.assigned_agent.updated等、`common_user_id`で識別し、
 *     代理店レコードとは無関係のペイロード形状を持つ)
 * を区別できるよう、`external_id`は任意にし、HUBイベント用のフィールド
 * (`entity`/`common_user`/`identities`/`system_links`/`agency_relations`/
 * `details`)も型として受け付ける。将来のフィールド追加(ガイド付則)に備え、
 * 未知のフィールドは無視せず素通りさせる(.passthrough())。
 */
export const AgencySyncRequestSchema = z
  .object({
    event: z.string().max(50).optional(),
    entity: z.string().max(50).optional(),
    dry_run: z.boolean().optional(),
    source: z.string().max(100).optional(),
    external_id: z.string().max(255).optional(),
    /** ガイド4章推奨の代理店公開識別子。現状はexternal_idを紐づけキーとして使い続け、metadataに併記する。 */
    agent_code: z.string().max(255).nullable().optional(),
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
    /** 共通顧客HUBイベント (ガイド11.2章) 用のペイロード。代理店同期処理では未使用、監査ログへ記録するのみ。 */
    common_user: z.record(z.unknown()).nullable().optional(),
    identities: z.array(z.record(z.unknown())).optional(),
    system_links: z.array(z.record(z.unknown())).optional(),
    agency_relations: z.array(z.record(z.unknown())).optional(),
    details: z.record(z.unknown()).optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type AgencySyncRequest = z.infer<typeof AgencySyncRequestSchema>;

/**
 * 外部開発者向け連携ガイド11.1章のイベント一覧のうち、代理店レコードではなく
 * 「共通顧客HUB」に関するイベント。代理店同期(syncAgency)の対象外とし、
 * 監査ログへの記録のみ行う(自動反映は共通ID接続機能の実装後に対応)。
 */
export const AGENCY_HUB_EVENT_TYPES = [
  "lead_created",
  "common_user.merged",
  "common_user.assigned_agent.updated",
] as const;

/** 代理店リンクの解除を意味するイベント (ガイド11.1章)。account_linkをREVOKEDへ遷移させる。 */
export const AGENCY_DEACTIVATION_EVENT_TYPES = ["deactivated", "deleted"] as const;

/** POST /api/v1/auth/sso/agency (仕様書12章)。sengoku-ai.com発行のSSO用JWTでログインする。 */
export const AgencySsoLoginRequestSchema = z.object({
  token: z.string().min(1),
  termsAccepted: z.boolean().optional(),
});
export type AgencySsoLoginRequest = z.infer<typeof AgencySsoLoginRequestSchema>;

/**
 * POST /api/integrations/events (千ノ国 全体統合 共通実装契約 v1.0 6.3章)。
 * 代理店システム等から送られる共通イベント本文。契約が定義する共通フィールドを
 * すべて任意項目として受け付け (イベント種別ごとに使うフィールドが異なるため)、
 * 未知のフィールドも素通りさせる (`.passthrough()`、付則での項目追加に備える)。
 */
export const CommonEventBodySchema = z
  .object({
    event_id: z.string().min(1).max(255),
    event_type: z.string().min(1).max(100),
    event_version: z.string().min(1).max(20),
    occurred_at: z.string().min(1),
    source_system_key: z.string().min(1).max(100),
    common_user_id: z.string().max(255).nullable().optional(),
    source_user_id: z.string().max(255).nullable().optional(),
    agency_id: z.string().max(255).nullable().optional(),
    registration_referrer_agency_id: z.string().max(255).nullable().optional(),
    assigned_agency_id: z.string().max(255).nullable().optional(),
    sales_agent_id: z.string().max(255).nullable().optional(),
    closing_agent_id: z.string().max(255).nullable().optional(),
    referral_session_key: z.string().max(255).nullable().optional(),
    order_id: z.string().max(255).nullable().optional(),
    order_item_id: z.string().max(255).nullable().optional(),
    product_code: z.string().max(255).nullable().optional(),
    entitlement_id: z.string().max(255).nullable().optional(),
    quantity: z.number().nullable().optional(),
    valid_from: z.string().nullable().optional(),
    valid_until: z.string().nullable().optional(),
    correlation_id: z.string().max(255).nullable().optional(),
    /**
     * リファクタリング指示書 Phase 5 (event_type別DTO)「正式フィールド候補」。
     * 従来`metadata.amount`/`metadata.previous_common_user_id`/
     * `metadata.original_event_id`としてのみ受け取っていた値を正式な最上位
     * フィールドへ昇格する。後方互換期間中は正式フィールドを優先し、未指定なら
     * 各ハンドラが`metadata`を旧形式fallbackとして参照する
     * (`common-events/handlers/*.handler.ts`参照)。
     */
    amount: z.number().optional(),
    previous_common_user_id: z.string().max(255).nullable().optional(),
    original_event_id: z.string().max(255).nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();
export type CommonEventBody = z.infer<typeof CommonEventBodySchema>;

/**
 * リファクタリング指示書 Phase 5 (event_type別DTO)。共通イベントの基本封筒フィールド。
 * `CommonEventBodySchema`(コントローラでの受信ゲート、全event_type共通・全項目任意) とは
 * 別に、event_typeごとの専用Schema (`*EventSchema`) が継承する土台として定義する。
 * `occurred_at`はコントローラのゲートと同じ緩い検証のままにし、専用Schema側で新たな
 * 拒否要因を増やさない。
 */
const BaseCommonEventSchema = z.object({
  event_id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(100),
  event_version: z.string().min(1).max(20),
  occurred_at: z.string().min(1),
  source_system_key: z.string().min(1).max(100),
  correlation_id: z.string().max(255).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

/**
 * event_type別Schema群。契約6.2章のうちウォレットが反応する6種類 (Phase 4の
 * `CommonEventHandler.schema`) に対応する。正式フィールド (amount等) は後方互換期間中
 * のため任意項目のままとし、必須チェックは各ハンドラの業務ロジック側で行う
 * (metadataフォールバックを許容する必要があるため)。
 */
export const CommonUserResolvedEventSchema = BaseCommonEventSchema.extend({
  event_type: z.literal("common_user.resolved"),
  common_user_id: z.string().max(255).nullable().optional(),
  source_user_id: z.string().max(255).nullable().optional(),
}).passthrough();

export const CommonUserMergedEventSchema = BaseCommonEventSchema.extend({
  event_type: z.literal("common_user.merged"),
  common_user_id: z.string().max(255).nullable().optional(),
  previous_common_user_id: z.string().max(255).nullable().optional(),
}).passthrough();

export const CustomerAssignmentChangedEventSchema = BaseCommonEventSchema.extend({
  event_type: z.literal("customer.assignment.changed"),
  common_user_id: z.string().max(255).nullable().optional(),
  assigned_agency_id: z.string().max(255).nullable().optional(),
  registration_referrer_agency_id: z.string().max(255).nullable().optional(),
}).passthrough();

export const ReferralConfirmedEventSchema = BaseCommonEventSchema.extend({
  event_type: z.literal("referral.confirmed"),
  common_user_id: z.string().max(255).nullable().optional(),
  referral_session_key: z.string().max(255).nullable().optional(),
}).passthrough();

export const RewardGrantedEventSchema = BaseCommonEventSchema.extend({
  event_type: z.literal("reward.granted"),
  common_user_id: z.string().max(255).nullable().optional(),
  product_code: z.string().max(255).nullable().optional(),
  amount: z.number().optional(),
}).passthrough();

export const RewardReversedEventSchema = BaseCommonEventSchema.extend({
  event_type: z.literal("reward.reversed"),
  original_event_id: z.string().max(255).nullable().optional(),
  entitlement_id: z.string().max(255).nullable().optional(),
  order_id: z.string().max(255).nullable().optional(),
}).passthrough();

/** 契約6.2章の必須イベントのうち、ウォレットが実際に反応するもの (5つの実装対象領域に対応)。 */
export const COMMON_EVENT_HANDLED_TYPES = [
  "common_user.resolved",
  "common_user.merged",
  "customer.assignment.changed",
  "referral.confirmed",
  "reward.granted",
  "reward.reversed",
] as const;

/** 共通契約v1.1 DRAFT 8章。サポート外`event_version`は422 unsupported_event_versionで拒否する。 */
export const COMMON_EVENT_SUPPORTED_VERSIONS = ["1.0"] as const;

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
