import { z } from "zod";

export const CreateNoticeSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  importance: z.enum(["NORMAL", "IMPORTANT"]).optional(),
  publishedAt: z.string().datetime().optional(),
});
