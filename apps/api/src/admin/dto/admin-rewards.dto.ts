import { z } from "zod";
import { ServiceCode, ApprovalType, RewardRuleStatus } from "@ove/shared-types";

const serviceCodeValues = Object.values(ServiceCode) as [string, ...string[]];
const approvalTypeValues = Object.values(ApprovalType) as [string, ...string[]];
const rewardRuleStatusValues = Object.values(RewardRuleStatus) as [string, ...string[]];

export const CreateRewardRuleSchema = z.object({
  ruleCode: z.string().min(1),
  ruleName: z.string().min(1),
  sourceService: z.enum(serviceCodeValues),
  rewardAmount: z.number().int().positive(),
  displayName: z.string().min(1),
  description: z.string().optional(),
  perUserLimit: z.number().int().positive().optional(),
  perEventLimit: z.number().int().positive().optional(),
  monthlyCountLimit: z.number().int().positive().optional(),
  monthlyAmountLimit: z.number().int().positive().optional(),
  globalAmountLimit: z.number().int().positive().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  approvalType: z.enum(approvalTypeValues).optional(),
  expiryDays: z.number().int().positive().optional(),
  /** 参加方法の案内先URL。httpsのみ (`rewards/landing-url.ts`で検証)。 */
  landingUrl: z.string().optional(),
});

export const UpdateRewardRuleSchema = z.object({
  ruleName: z.string().min(1).optional(),
  rewardAmount: z.number().int().positive().optional(),
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(rewardRuleStatusValues).optional(),
  perUserLimit: z.number().int().positive().nullable().optional(),
  perEventLimit: z.number().int().positive().nullable().optional(),
  monthlyCountLimit: z.number().int().positive().nullable().optional(),
  monthlyAmountLimit: z.number().int().positive().nullable().optional(),
  globalAmountLimit: z.number().int().positive().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  approvalType: z.enum(approvalTypeValues).optional(),
  expiryDays: z.number().int().positive().nullable().optional(),
  /** 参加方法の案内先URL。空文字を送ると未設定に戻せる。 */
  landingUrl: z.string().nullable().optional(),
});
