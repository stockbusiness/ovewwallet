import { Injectable, Logger } from "@nestjs/common";
import { generateId } from "@ove/database";
import { isFeatureEnabled } from "../common/feature-flags";
import { GrantRewardUseCase } from "./grant-reward.use-case";
import { RewardRuleRepository } from "./reward-rule.repository";

/** 付与ルールのコード。管理画面 (/reward-rules) から金額・上限を変更できる。 */
export const WALLET_SIGNUP_BONUS_RULE_CODE = "WALLET_SIGNUP_BONUS";
export const PROFILE_COMPLETION_BONUS_RULE_CODE = "PROFILE_COMPLETION_BONUS";

/**
 * ウォレット内の出来事を条件にしたORI付与 (docs/milestone-rewards.md)。
 *
 * 新規登録の3000 ORIを一度に配るのをやめ、段階に分けて配る運用に合わせたもの
 * (2026-09-05 運用判断)。ウォレットが自分で達成を知っている2つ
 * (新規登録・お客様情報の登録) をここで扱う。3つ目のAIアート教室LINE登録は
 * ウォレットの外の出来事なので、当面は管理画面から手動で付与する。
 *
 * ## 失敗しても本来の処理は止めない
 *
 * 特典が付かないことより、**登録そのものやお客様情報の保存が失敗するほうが害が大きい**。
 * 付与ルールが未登録・停止中でも、登録は成功させる。失敗はログに残し、後から
 * 管理画面のCSV一括付与で救済できるようにする。
 *
 * 金額はここに書かない。`reward_rules.reward_amount` を読むため、運用中に
 * 管理画面から変えられる。
 *
 * ## 既定OFF
 *
 * `ENABLE_WALLET_MILESTONE_REWARDS` が true のときだけ付与する。開けるには
 * **代理店システムが送っている3000 ORIを先に止めてもらう必要があり**
 * (止めないと合計5000になる)、その調整が済むまでコードだけ入れておけるように
 * するため (docs/milestone-rewards.md、開発ガイドライン13章の既定OFF方針)。
 */
@Injectable()
export class MilestoneRewardsService {
  private readonly logger = new Logger(MilestoneRewardsService.name);

  constructor(
    private readonly grantReward: GrantRewardUseCase,
    private readonly rewardRules: RewardRuleRepository,
  ) {}

  /** 新規登録特典。1人1回 (冪等キーとルールの per_user_limit の両方で担保)。 */
  async grantSignupBonus(oveAccountId: string): Promise<void> {
    await this.grantQuietly({
      oveAccountId,
      ruleCode: WALLET_SIGNUP_BONUS_RULE_CODE,
      transactionType: "WALLET_SIGNUP_BONUS",
      displayName: "新規登録",
      description: "ORIウォレットへのご登録ありがとうございます。",
      idempotencyKey: `WALLET_SIGNUP_BONUS:${oveAccountId}`,
    });
  }

  /** お客様情報の登録特典。完了の判定は`isProfileComplete()`が行う。 */
  async grantProfileCompletionBonus(oveAccountId: string): Promise<void> {
    await this.grantQuietly({
      oveAccountId,
      ruleCode: PROFILE_COMPLETION_BONUS_RULE_CODE,
      transactionType: "PROFILE_COMPLETION_BONUS",
      displayName: "お客様情報の登録",
      description: "お客様情報のご登録ありがとうございます。",
      idempotencyKey: `PROFILE_COMPLETION_BONUS:${oveAccountId}`,
    });
  }

  private async grantQuietly(params: {
    oveAccountId: string;
    ruleCode: string;
    transactionType: "WALLET_SIGNUP_BONUS" | "PROFILE_COMPLETION_BONUS";
    displayName: string;
    description: string;
    idempotencyKey: string;
  }): Promise<void> {
    if (!isFeatureEnabled("ENABLE_WALLET_MILESTONE_REWARDS")) return;

    try {
      // 金額はルールから読む。管理画面で変えた値がそのまま効くようにするため
      // (コードに金額を書かない)。
      const rule = await this.rewardRules.findByRuleCode(params.ruleCode);
      if (!rule || rule.status !== "ACTIVE") {
        this.logger.warn(
          `milestone reward skipped: rule=${params.ruleCode} is not registered or not ACTIVE`,
        );
        return;
      }

      await this.grantReward.execute({
        oveAccountId: params.oveAccountId,
        amount: rule.rewardAmount,
        transactionType: params.transactionType,
        idempotencyKey: params.idempotencyKey,
        displayName: params.displayName,
        description: params.description,
        sourceService: "OVE_WALLET",
        sourceReferenceId: generateId(),
        createdByType: "SYSTEM",
        ruleCode: params.ruleCode,
      });
    } catch (err) {
      // 付与できなくても登録・保存は成功させる。上限到達や設定漏れが理由のことも
      // あるため、原因を残して後から追えるようにする (口座IDは秘密ではない)。
      this.logger.warn(
        `milestone reward not granted: rule=${params.ruleCode} account=${params.oveAccountId} ` +
          `reason=${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
}
