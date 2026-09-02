import { z } from "zod";
import { ServiceCode, TransactionType } from "./enums";

const serviceCodeValues = Object.values(ServiceCode) as [string, ...string[]];
const transactionTypeValues = Object.values(TransactionType) as [
  string,
  ...string[],
];

/** POST /api/v1/rewards/grant */
export const RewardGrantRequestSchema = z.object({
  service_code: z.enum(serviceCodeValues),
  external_user_id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(100),
  event_id: z.string().min(1).max(255),
  amount: z.number().int().positive(),
  transaction_type: z
    .enum(transactionTypeValues)
    .default(TransactionType.EVENT_REWARD),
  display_name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  idempotency_key: z.string().min(1).max(255),
});
export type RewardGrantRequest = z.infer<typeof RewardGrantRequestSchema>;

/**
 * 千ノ国 全体統合 共通実装契約のcommon_user_id発行形式(`cu_`+32桁16進数)。PR-W2・PR-W3-aの
 * 複数箇所(残高API・共通イベント契約のentitlement系スキーマ)で同じ形式検証を重複させない
 * ための共通定数。trim・大文字小文字変換はしない(前後空白・大文字混入はそのまま拒否する)。
 */
export const COMMON_USER_ID_PATTERN = /^cu_[0-9a-f]{32}$/;
export const CommonUserIdSchema = z
  .string()
  .regex(COMMON_USER_ID_PATTERN, "Invalid common_user_id format");

/**
 * POST /api/v1/service/accounts/by-common-user-id/balance (PR-W2)。
 * 形式不正はResolver・DB検索を実行する前に400で弾く。
 */
export const CommonUserIdBalanceRequestSchema = z.object({
  common_user_id: CommonUserIdSchema,
});
export type CommonUserIdBalanceRequest = z.infer<
  typeof CommonUserIdBalanceRequestSchema
>;

/**
 * PR-W3-a: entitlement.revoked/grantedのreason_code等、構造化コード文字列の共通形式。
 * 小文字英数字+アンダースコアのみ、先頭は英字、最大64文字。既知語彙は
 * apps/api/src/collectibles/constants.tsのKNOWN_COLLECTIBLE_REVOKE_REASON_CODESで管理する
 * (未知コードは拒否せず受理し、表示のみ汎用文言へフォールバックする)。
 */
export const COLLECTIBLE_REVOKE_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const CollectibleRevokeReasonCodeSchema = z
  .string()
  .regex(COLLECTIBLE_REVOKE_REASON_CODE_PATTERN, "Invalid reason_code format")
  .nullable()
  .optional();

/** POST /api/v1/transactions/debit */
export const DebitRequestSchema = z.object({
  service_code: z.enum(serviceCodeValues),
  external_user_id: z.string().min(1).max(255),
  amount: z.number().int().positive(),
  transaction_type: z
    .enum(transactionTypeValues)
    .default(TransactionType.ITEM_EXCHANGE),
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
export const AGENCY_DEACTIVATION_EVENT_TYPES = [
  "deactivated",
  "deleted",
] as const;

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
    /** 千ノ国NFTマーケット契約v2指示書16〜17章。業務項目のネスト先 (旧フラット契約との併存)。 */
    data: z.record(z.unknown()).nullable().optional(),
    /** 同19章。送信先サービスの識別子。 */
    target_site_key: z.string().nullable().optional(),
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
  /** 千ノ国NFTマーケット契約v2指示書16〜17章。業務項目のネスト先。旧フラット契約との
   * 併存期間中は各ハンドラのNormalizerが`data.field`とトップレベルfieldを突き合わせる。 */
  data: z.record(z.unknown()).nullable().optional(),
  /** 同19章。送信先サービスの識別子。誤配送防止のため一致検証する。 */
  target_site_key: z.string().nullable().optional(),
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

export const CustomerAssignmentChangedEventSchema =
  BaseCommonEventSchema.extend({
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

/**
 * 代理店システム(sengoku-ai.com)からの付与イベント `orly.point_award.wallet_delivery`
 * (`docs/integration/AGENCY_POINT_AWARD.md`)。紹介関係が確定したあと、代理店システムが
 * 「誰に何ポイント付けるか」を決めてウォレットへ配信してくる。
 *
 * 数値項目 (`id` / `campaign_id` / `*_agent_id`) は、送信側の実装次第で数値・文字列の
 * どちらでも来うるため両方受け付ける。実際に使う値の型・範囲の検証は受け取った側
 * (`PointAwardWalletDeliveryHandler`) で行う。
 */
const AgentIdSchema = z.union([z.number(), z.string().max(255)]);

export const PointAwardSchema = z
  .object({
    id: AgentIdSchema.nullable().optional(),
    /** 付与1件を一意に識別する送信側のキー。event_idと並ぶ、もう一つの冪等キー。 */
    award_event_key: z.string().min(1).max(255),
    campaign_id: AgentIdSchema.nullable().optional(),
    campaign_version_id: AgentIdSchema.nullable().optional(),
    point_code: z.string().max(50).nullable().optional(),
    /** 付与先。common_user_id か agent_id のどちらかは必須 (どちらも無ければ400)。 */
    recipient_common_user_id: z.string().max(255).nullable().optional(),
    recipient_agent_id: AgentIdSchema.nullable().optional(),
    /** direct_referrer / upper_director 等。台帳のmetadataに記録するだけで分岐には使わない。 */
    recipient_type: z.string().max(50).nullable().optional(),
    target_common_user_id: z.string().max(255).nullable().optional(),
    trigger_event_type: z.string().max(100).nullable().optional(),
    trigger_event_id: z.string().max(255).nullable().optional(),
    source_system_key: z.string().max(100).nullable().optional(),
    project_key: z.string().max(50).nullable().optional(),
    direct_referrer_agent_id: AgentIdSchema.nullable().optional(),
    upper_director_agent_id: AgentIdSchema.nullable().optional(),
    points: z.number(),
    status: z.string().max(50).nullable().optional(),
  })
  .passthrough();
export type PointAward = z.infer<typeof PointAwardSchema>;

export const POINT_AWARD_WALLET_DELIVERY_EVENT_TYPE =
  "orly.point_award.wallet_delivery";

export const PointAwardWalletDeliveryEventSchema =
  BaseCommonEventSchema.extend({
    event_type: z.literal(POINT_AWARD_WALLET_DELIVERY_EVENT_TYPE),
    point_award: PointAwardSchema,
  }).passthrough();

/** 千ノ国NFTマーケット契約v2指示書19章。このWallet自身のsite_key。 */
export const NFT_MARKET_WALLET_TARGET_SITE_KEY = "ovew-wallet";

/**
 * PR-W3-a: event_version 1.1では、data.entitlement_id/common_user_id/correlation_id/
 * target_site_keyを必須にする(千ノ国NFTマーケット契約M3a)。1.0は既存の緩い契約のまま
 * (新たな拒否要因を増やさない)。トップレベル値へのフォールバックは1.0互換処理専用の
 * normalizeEntitlementEnvelope(apps/api側)でのみ行い、1.1の必須判定では行わない
 * (data.entitlement_idが無ければ、トップレベルにentitlement_idがあっても1.1としては不正)。
 */
/** ISO 8601 UTC ("...Z"サフィックス必須、オフセット表記は不可) かつDate.parseできる値のみ許可。 */
const ISO_8601_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function requireEntitlementFieldsForV1_1(
  body: {
    event_type: string;
    event_version: string;
    occurred_at: string;
    common_user_id?: string | null;
    correlation_id?: string | null;
    target_site_key?: string | null;
    reason_code?: string | null;
    data?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  if (body.event_version !== "1.1") return;
  const dataObj =
    (body.data as Record<string, unknown> | null | undefined) ?? undefined;
  const require = (
    present: boolean,
    path: (string | number)[],
    label: string,
  ) => {
    if (!present) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `${label} is required for event_version 1.1`,
      });
    }
  };
  require(body.common_user_id != null, ["common_user_id"], "common_user_id");
  if (
    body.common_user_id != null &&
    !COMMON_USER_ID_PATTERN.test(body.common_user_id)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["common_user_id"],
      message: "Invalid common_user_id format",
    });
  }
  require(body.correlation_id != null, ["correlation_id"], "correlation_id");
  require(dataObj?.["entitlement_id"] != null, [
    "data",
    "entitlement_id",
  ], "data.entitlement_id");
  require(body.target_site_key === NFT_MARKET_WALLET_TARGET_SITE_KEY, [
    "target_site_key",
  ], `target_site_key ("${NFT_MARKET_WALLET_TARGET_SITE_KEY}")`);
  const occurredAtValid =
    ISO_8601_UTC_PATTERN.test(body.occurred_at) &&
    !Number.isNaN(Date.parse(body.occurred_at));
  if (!occurredAtValid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["occurred_at"],
      message:
        "occurred_at must be a valid ISO 8601 UTC timestamp for event_version 1.1",
    });
  }
  // reason_codeはentitlement.revoked固有(entitlement.grantedには存在しない概念)。
  if (body.event_type === "entitlement.revoked") {
    require(body.reason_code != null, ["reason_code"], "reason_code");
  }
}

/**
 * NFTコレクション実装指示書8章。戦国マーケットで購入したデジタルカードの利用権付与。
 * 実際の必須チェック(metadata.entitlement_type/asset_code/name/image_url、
 * quantity===1等)はハンドラ側で行う (他のevent_type別Schema同様、metadataは
 * 後方互換のため任意項目のままにする)。
 */
export const EntitlementGrantedEventSchema = BaseCommonEventSchema.extend({
  event_type: z.literal("entitlement.granted"),
  // common_user_idの形式検証(cu_[0-9a-f]{32})は1.1のみ強制する(requireEntitlementFieldsForV1_1)。
  // 1.0の既存契約(docs/contracts/fixtures/*.v1.jsonの"cu_xxx"等)はこの形式に従わないため、
  // フィールド定義自体は緩いままにする(新たな拒否要因を増やさない)。
  common_user_id: z.string().max(255).nullable().optional(),
  // PR#2最終修正 P0-4: 業務項目はトップレベルに置くフラットな契約
  // (docs/contracts/fixtures/digital-collectible-granted.v1.json参照)。
  source_user_id: z.string().max(255).nullable().optional(),
  order_id: z.string().max(255).nullable().optional(),
  order_item_id: z.string().max(255).nullable().optional(),
  product_code: z.string().max(255).nullable().optional(),
  entitlement_id: z.string().max(255).nullable().optional(),
  quantity: z.number().nullable().optional(),
})
  .passthrough()
  .superRefine(requireEntitlementFieldsForV1_1);

/** NFTコレクション実装指示書8章。利用権の取消 (全額返金等)。 */
export const EntitlementRevokedEventSchema = BaseCommonEventSchema.extend({
  event_type: z.literal("entitlement.revoked"),
  entitlement_id: z.string().max(255).nullable().optional(),
  common_user_id: z.string().max(255).nullable().optional(),
  reason_code: CollectibleRevokeReasonCodeSchema,
})
  .passthrough()
  .superRefine(requireEntitlementFieldsForV1_1);

/** 契約6.2章の必須イベントのうち、ウォレットが実際に反応するもの (5つの実装対象領域に対応)。 */
export const COMMON_EVENT_HANDLED_TYPES = [
  "common_user.resolved",
  "common_user.merged",
  "customer.assignment.changed",
  "referral.confirmed",
  "reward.granted",
  "reward.reversed",
  /** NFTコレクション実装指示書8章。 */
  "entitlement.granted",
  "entitlement.revoked",
] as const;

/**
 * PR-W3-a: event_type別の対応event_version表。「共通定数に1件追加しただけで全event_typeが
 * 新versionを受理してしまう」設計を避けるため、event_type単位で管理する。表に無い
 * event_type(Walletがハンドラを登録していない、契約上は正当な種別)は
 * DEFAULT_SUPPORTED_EVENT_VERSIONSがそのまま適用され、1.0のみを受理する(既存動作を維持)。
 */
export const EVENT_TYPE_SUPPORTED_VERSIONS: Record<string, readonly string[]> =
  {
    "common_user.resolved": ["1.0"],
    "common_user.merged": ["1.0"],
    "customer.assignment.changed": ["1.0"],
    "referral.confirmed": ["1.0"],
    "reward.granted": ["1.0"],
    "reward.reversed": ["1.0"],
    /** 千ノ国NFTマーケット契約M3a。 */
    "entitlement.granted": ["1.0", "1.1"],
    "entitlement.revoked": ["1.0", "1.1"],
    [POINT_AWARD_WALLET_DELIVERY_EVENT_TYPE]: ["1.0"],
  };
/** 上の表に無いevent_type(Walletがハンドラを登録していない種別)に適用する既定値。 */
export const DEFAULT_SUPPORTED_EVENT_VERSIONS = ["1.0"] as const;

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
