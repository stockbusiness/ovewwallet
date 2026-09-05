import { z } from "zod";

/**
 * カード画像の保管先設定。**シークレットは空欄で保存できる** (現在の値を維持する意図)。
 * バケット等は空文字を「未設定へ戻す」意図として受け付ける。
 */
export const ImageStorageConfigUpdateSchema = z.object({
  bucket: z.string().max(255).optional(),
  endpoint: z.string().max(500).optional(),
  region: z.string().max(64).optional(),
  accessKeyId: z.string().max(255).optional(),
  secretAccessKey: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
});
