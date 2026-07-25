import { z } from "zod";

export const GrantSchema = z.object({
  walletId: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().min(1),
  idempotencyKey: z.string().optional(),
});
export const DeductSchema = GrantSchema;
export const ReverseSchema = z.object({ reason: z.string().min(1), idempotencyKey: z.string().optional() });
export const HoldSchema = z.object({
  walletId: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().min(1),
  idempotencyKey: z.string().optional(),
});
export const ReleaseSchema = z.object({ idempotencyKey: z.string().optional() });
export const BulkGrantPreviewSchema = z.object({ fileName: z.string().min(1), csvContent: z.string().min(1) });
export const BulkGrantExecuteSchema = z.object({
  fileName: z.string().min(1),
  csvContent: z.string().min(1),
  batchId: z.string().optional(),
});
