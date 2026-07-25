import { z } from "zod";

/**
 * NFTコレクション実装指示書「画像セキュリティ」。カード画像はHTTPS URLのみ許可し、
 * SVG(スクリプト実行のリスクがある)は拒否する。
 */
const secureImageUrl = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://"), { message: "image URL must use https://" })
  .refine((url) => !new URL(url).pathname.toLowerCase().endsWith(".svg"), { message: "SVG images are not allowed" });

export const CreateCollectibleAssetSchema = z.object({
  assetCode: z.string().min(1).max(255),
  productCode: z.string().max(255).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: secureImageUrl,
  thumbnailUrl: secureImageUrl.optional(),
  rarity: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  editionSize: z.number().int().positive().optional(),
});

export const UpdateCollectibleAssetSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  imageUrl: secureImageUrl.optional(),
  thumbnailUrl: secureImageUrl.nullable().optional(),
  rarity: z.string().max(100).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  editionSize: z.number().int().positive().nullable().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export const RevokeCollectibleHoldingSchema = z.object({ reason: z.string().min(1) });
