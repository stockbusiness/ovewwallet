import { z } from "zod";

export const RejectApprovalSchema = z.object({ reason: z.string().min(1) });
