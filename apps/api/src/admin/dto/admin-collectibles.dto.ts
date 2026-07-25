import { z } from "zod";
import { assertValidCollectibleImageUrl, InvalidCollectibleImageUrlError } from "../../common/image-url-validator";

/**
 * NFTコレクション実装指示書「画像セキュリティ」。PR#2最終修正 P1-2により、
 * `entitlement.granted`のmetadata.image_url検証と同じ共有バリデーターを使う
 * (HTTPS限定・SVG拒否・URL長上限・localhost/loopback/private IP/link-local拒否・
 * `COLLECTIBLE_IMAGE_ALLOWED_HOSTS`許可リスト)。
 */
const secureImageUrl = z.string().url().superRefine((url, ctx) => {
  try {
    assertValidCollectibleImageUrl(url);
  } catch (error) {
    if (error instanceof InvalidCollectibleImageUrlError) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message });
    } else {
      throw error;
    }
  }
});

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
