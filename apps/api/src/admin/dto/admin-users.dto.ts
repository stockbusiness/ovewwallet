import { z } from "zod";

/**
 * 管理者が自分で設定するパスワードの最小長。初期パスワード・リセット時に発行する
 * ランダム文字列 (`generateOpaqueToken(12)` = base64urlで16文字) はこれを満たす。
 */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "OVE_OPERATOR",
  "INTEGRATION_ADMIN",
  "EVENT_OPERATOR",
  "AUDITOR",
  "VIEWER",
] as const;

export const CreateAdminUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  role: z.enum(ADMIN_ROLES),
});

/** 変更したい項目だけを渡す。空オブジェクトは変更なしとして拒否する。 */
export const UpdateAdminUserSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    role: z.enum(ADMIN_ROLES).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .refine(
    (v) => v.displayName !== undefined || v.role !== undefined || v.status !== undefined,
    { message: "displayName / role / status のいずれかを指定してください" },
  );

export const ResetAdminPasswordSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const ChangeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).max(200),
});
