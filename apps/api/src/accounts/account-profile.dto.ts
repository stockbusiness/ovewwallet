import { z } from "zod";

/**
 * プロフィール更新の入力 (docs/account-profile.md)。
 *
 * 項目を省略すれば現状維持、空文字を送れば削除。**必須の判定はここでは行わない**。
 * どの項目を必須とみなすかは管理画面の設定次第で、しかも未入力でもウォレットは
 * 使えるようにしているため (未入力であること自体をセグメントに使う)。
 * 書式の検証と正規化は`AccountProfileService`が行う。
 */
export const AccountProfileUpdateSchema = z.object({
  fullName: z.string().max(100).optional(),
  fullNameKana: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  postalCode: z.string().max(10).optional(),
  prefecture: z.string().max(10).optional(),
  city: z.string().max(100).optional(),
  addressLine: z.string().max(100).optional(),
  building: z.string().max(100).optional(),
});

export type AccountProfileUpdate = z.infer<typeof AccountProfileUpdateSchema>;
