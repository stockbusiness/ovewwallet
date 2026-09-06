import { z } from "zod";

export const SUPPORT_INQUIRY_CATEGORIES = [
  "REWARD_NOT_GRANTED",
  "BALANCE_MISMATCH",
  "LOGIN_OR_ACCOUNT",
  "COLLECTIBLE",
  "OTHER",
] as const;

/**
 * 本文の上限。長い経緯を書けるだけの余裕は要るが、無制限にはしない
 * (画面にそのまま出す値なので、運用側が読める範囲に収める)。
 */
export const SUPPORT_INQUIRY_MESSAGE_MAX = 2000;

export const SupportInquiryCreateSchema = z.object({
  category: z.enum(SUPPORT_INQUIRY_CATEGORIES),
  message: z.string().trim().min(1).max(SUPPORT_INQUIRY_MESSAGE_MAX),
});

export const SupportInquiryReplySchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(2000),
});

export const SupportInquiryStatusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "ANSWERED", "CLOSED"]),
  /** 運用メモ。利用者には見せない。 */
  internalNote: z.string().max(2000).optional(),
});
