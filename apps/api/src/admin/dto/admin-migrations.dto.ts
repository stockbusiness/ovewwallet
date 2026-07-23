import { z } from "zod";

export const ResolveReviewSchema = z.object({
  confirmedBalance: z.number().int().min(0),
  reason: z.string().min(1),
});

export const MigrationRequestSchema = z.object({
  fileName: z.string().min(1),
  csvContent: z.string().min(1),
  batchName: z.string().min(1),
  reason: z.string().min(1),
});
