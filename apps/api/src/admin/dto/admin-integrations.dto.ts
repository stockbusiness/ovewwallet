import { z } from "zod";

export const ServiceIntegrationActionSchema = z.object({ reason: z.string().min(1) });

export const CommonUserHubConfigUpdateSchema = z.object({
  baseUrl: z.string().url().optional(),
  systemKey: z.string().min(1).max(100).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  reason: z.string().min(1),
});
