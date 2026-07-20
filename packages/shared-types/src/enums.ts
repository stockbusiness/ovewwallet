/**
 * データモデル (docs/database.md) の enum と1:1で対応させる。
 * Prisma schema の enum ともキー名を一致させること。
 */

export const AccountStatus = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  RESTRICTED: "RESTRICTED",
  REVIEWING: "REVIEWING",
  LOCKED: "LOCKED",
  CLOSED: "CLOSED",
  MERGED: "MERGED",
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const IdentityType = {
  LINE: "LINE",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  PASSKEY: "PASSKEY",
  GOOGLE: "GOOGLE",
  APPLE: "APPLE",
  BLOCKCHAIN_WALLET: "BLOCKCHAIN_WALLET",
} as const;
export type IdentityType = (typeof IdentityType)[keyof typeof IdentityType];

export const ServiceCode = {
  SENGOKU_PASSPORT: "SENGOKU_PASSPORT",
  AIART: "AIART",
  SENGOKU_GACHA: "SENGOKU_GACHA",
  SENGOKU_EC: "SENGOKU_EC",
  NFT_MARKET: "NFT_MARKET",
  SENGOKU_METAVERSE: "SENGOKU_METAVERSE",
  EVENT_SYSTEM: "EVENT_SYSTEM",
} as const;
export type ServiceCode = (typeof ServiceCode)[keyof typeof ServiceCode];

export const WalletStatus = {
  ACTIVE: "ACTIVE",
  RESTRICTED: "RESTRICTED",
  LOCKED: "LOCKED",
  REVIEWING: "REVIEWING",
  MIGRATING: "MIGRATING",
  MIGRATED: "MIGRATED",
  CLOSED: "CLOSED",
  MERGED: "MERGED",
} as const;
export type WalletStatus = (typeof WalletStatus)[keyof typeof WalletStatus];

export const TransactionDirection = {
  CREDIT: "CREDIT",
  DEBIT: "DEBIT",
} as const;
export type TransactionDirection = (typeof TransactionDirection)[keyof typeof TransactionDirection];

export const TransactionStatus = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  HELD: "HELD",
  FAILED: "FAILED",
  REVERSED: "REVERSED",
  MIGRATING: "MIGRATING",
  MIGRATED: "MIGRATED",
} as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

export const TransactionType = {
  REGISTRATION_BONUS: "REGISTRATION_BONUS",
  AIART_ATTENDANCE: "AIART_ATTENDANCE",
  SENGOKU_EC_PURCHASE: "SENGOKU_EC_PURCHASE",
  EVENT_REWARD: "EVENT_REWARD",
  CAMPAIGN_REWARD: "CAMPAIGN_REWARD",
  REFERRAL_REWARD: "REFERRAL_REWARD",
  PURCHASE_REWARD: "PURCHASE_REWARD",
  GACHA_REWARD: "GACHA_REWARD",
  ADMIN_GRANT: "ADMIN_GRANT",
  ADMIN_DEDUCTION: "ADMIN_DEDUCTION",
  OPENING_BALANCE: "OPENING_BALANCE",
  GACHA_TICKET_EXCHANGE: "GACHA_TICKET_EXCHANGE",
  COUPON_EXCHANGE: "COUPON_EXCHANGE",
  ITEM_EXCHANGE: "ITEM_EXCHANGE",
  HOLD: "HOLD",
  RELEASE: "RELEASE",
  REVERSAL: "REVERSAL",
  RECOVERY: "RECOVERY",
  ACCOUNT_MERGE_IN: "ACCOUNT_MERGE_IN",
  ACCOUNT_MERGE_OUT: "ACCOUNT_MERGE_OUT",
  BLOCKCHAIN_MIGRATION: "BLOCKCHAIN_MIGRATION",
  MIGRATION_REVERSAL: "MIGRATION_REVERSAL",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const ApprovalType = {
  AUTOMATIC: "AUTOMATIC",
  MANUAL: "MANUAL",
} as const;
export type ApprovalType = (typeof ApprovalType)[keyof typeof ApprovalType];

export const RewardRuleStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SCHEDULED: "SCHEDULED",
  ENDED: "ENDED",
} as const;
export type RewardRuleStatus = (typeof RewardRuleStatus)[keyof typeof RewardRuleStatus];

export const WalletHoldStatus = {
  HELD: "HELD",
  RELEASED: "RELEASED",
} as const;
export type WalletHoldStatus = (typeof WalletHoldStatus)[keyof typeof WalletHoldStatus];

export const AdminRole = {
  SUPER_ADMIN: "SUPER_ADMIN",
  OVE_OPERATOR: "OVE_OPERATOR",
  INTEGRATION_ADMIN: "INTEGRATION_ADMIN",
  EVENT_OPERATOR: "EVENT_OPERATOR",
  AUDITOR: "AUDITOR",
  VIEWER: "VIEWER",
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const CreatedByType = {
  USER: "USER",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
  EXTERNAL_SERVICE: "EXTERNAL_SERVICE",
} as const;
export type CreatedByType = (typeof CreatedByType)[keyof typeof CreatedByType];
