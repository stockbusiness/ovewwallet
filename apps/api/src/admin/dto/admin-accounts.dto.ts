import { z } from "zod";

export const AccountMergeSchema = z.object({
  sourceAccountCode: z.string().min(1),
  targetAccountCode: z.string().min(1),
  reason: z.string().min(1),
});

/**
 * 共通IDの再解決。外部(共通顧客HUB)へ問い合わせて本人紐付けを変える操作なので、
 * 監査ログに残す理由を必須にする。
 */
export const ResolveCommonUserSchema = z.object({
  reason: z.string().min(1),
});
