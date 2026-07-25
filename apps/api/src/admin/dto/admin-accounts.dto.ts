import { z } from "zod";

export const AccountMergeSchema = z.object({
  sourceAccountCode: z.string().min(1),
  targetAccountCode: z.string().min(1),
  reason: z.string().min(1),
});
