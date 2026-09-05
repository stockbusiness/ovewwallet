import { z } from "zod";

export const ServiceIntegrationActionSchema = z.object({ reason: z.string().min(1) });

export const CommonUserHubConfigUpdateSchema = z.object({
  baseUrl: z.string().url().optional(),
  systemKey: z.string().min(1).max(100).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  reason: z.string().min(1),
});

/**
 * 代理店の担当者と ORI アカウントを管理者が手動で紐付ける
 * (`docs/agency-integration.md`)。`account` は運用担当者が管理画面で目にする
 * アカウントコード (`OVE-ACC-...`) でも、内部IDでも受け付ける。
 */
export const AgencyLinkManualLinkSchema = z.object({
  account: z.string().min(1).max(255),
  reason: z.string().min(1),
});

export const AgencyLinkUnlinkSchema = z.object({ reason: z.string().min(1) });

/** 紹介の後付け紐付け (`POST /api/v1/admin/wallet-referrals/:id/attach`)。 */
export const WalletReferralManualAttachSchema = z.object({
  /** ORIアカウントのコード (ORI-ACC-...) またはID。 */
  account: z.string().min(1).max(255),
  reason: z.string().min(1),
});

/**
 * メール送信設定 (docs/login-methods.md)。APIキーを空欄で保存すると現在の鍵を維持する
 * (共通顧客HUB送信設定と同じ挙動)。
 */
export const MailConfigUpdateSchema = z.object({
  apiKey: z.string().min(1).max(500).optional(),
  mailFrom: z.string().email().optional(),
  reason: z.string().min(1),
});

/** テスト送信の宛先。 */
export const MailTestSendSchema = z.object({
  to: z.string().email(),
});

/**
 * プロフィール項目の要求レベル設定 (docs/account-profile.md)。省略した項目は現状維持。
 * REQUIRED にしてもウォレットの利用は止まらない (促す帯が出るだけ)。
 */
const ProfileFieldRequirementSchema = z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"]);

export const ProfileConfigUpdateSchema = z.object({
  fullName: ProfileFieldRequirementSchema.optional(),
  fullNameKana: ProfileFieldRequirementSchema.optional(),
  phone: ProfileFieldRequirementSchema.optional(),
  postalCode: ProfileFieldRequirementSchema.optional(),
  address: ProfileFieldRequirementSchema.optional(),
  promptEnabled: z.boolean().optional(),
  reason: z.string().min(1),
});
