import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, type OveAccount, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { CommonUserHubClient } from "../common-user-hub/common-user-hub.client";
import { ReferralsService } from "../referrals/referrals.service";
import { AccountRepository } from "./account.repository";

/**
 * リファクタリング指示書 Phase 2: `AccountsService`から分離した
 * Common User Hub連携責務 (common_user_id解決・保存、紐付け後の紹介confirm)。
 */
@Injectable()
export class CommonUserLinkingService {
  private readonly logger = new Logger(CommonUserLinkingService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly commonUserHub: CommonUserHubClient,
    private readonly referrals: ReferralsService,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * 代理店システム内共通顧客HUBへcommon_user_idを解決・保存する
   * (外部開発者向け連携ガイド9.1章)。`ENABLE_PLATFORM_USER_ID`無効時や
   * 送信APIキー未設定時はCommonUserHubClient側で自動的にno-opになる。
   * 外部HTTP呼び出しをDBトランザクション内に含めない (接続保持・タイムアウトを
   * 避けるため)。ベストエフォートのため失敗しても登録自体は成功済みのまま返す。
   */
  async tryLinkCommonUser(account: OveAccount): Promise<void> {
    try {
      const result = await this.commonUserHub.resolve({
        externalUserId: account.id,
        email: account.primaryEmail,
        phone: account.primaryPhone,
        displayName: account.displayName,
      });
      if (!result) return;

      // モジュール化後レビュー対応 P1-2: common_user_idにUNIQUE制約が無いため、
      // 他アカウントに同じ値が既に設定されていないかを保存前に必ず確認する。
      const conflictingAccounts = await this.accountRepository.findConflictingCommonUserLinks(
        result.commonUserId,
        account.id,
      );
      if (conflictingAccounts.length > 0) {
        await this.db.auditLog.create({
          data: {
            id: generateId(),
            actorType: "SYSTEM",
            actionType: "COMMON_USER_RESOLVED_CONFLICT",
            targetType: "ove_account",
            targetId: account.id,
            result: "FAILURE",
            reason: `common_user_id "${result.commonUserId}" は既に他のOVEアカウントに設定済みのため自動設定しない`,
            afterData: {
              rejectedCommonUserId: result.commonUserId,
              conflictingAccountIds: conflictingAccounts.map((a) => a.id),
            },
          },
        });
        this.logger.warn(
          `common_user_id ${result.commonUserId} is already linked to another account; skipping auto-link for account ${account.id}`,
        );
        return;
      }

      await this.accountRepository.linkCommonUser(account.id, result.commonUserId);

      // 紹介Phase 2 (共通実装契約5章): 「本人ログイン・common user resolve後にconfirmする」。
      // ベストエフォート (失敗しても登録・ログイン自体はブロックしない)。
      await this.referrals.confirmAfterCommonUserResolve(account.id, result.commonUserId);
    } catch (error) {
      this.logger.warn(
        `failed to link common_user_id for account ${account.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
