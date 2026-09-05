import { z } from "zod";

export const EmailDomainRuleUpsertSchema = z.object({
  domain: z.string().min(3).max(253),
  /** BLOCK は組み込みリストへの追加、ALLOW は組み込みリストの誤検知の解除。 */
  action: z.enum(["BLOCK", "ALLOW"]),
  /** なぜ追加したかの覚書。監査ログにも残す。 */
  reason: z.string().max(500).optional(),
});

export const EmailDomainRuleRemoveSchema = z.object({
  domain: z.string().min(3).max(253),
});
