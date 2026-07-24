import { Injectable, Logger } from "@nestjs/common";
import type { OveAccount } from "@ove/database";
import { CommonUserHubClient } from "../common-user-hub/common-user-hub.client";
import { ReferralsService } from "../referrals/referrals.service";
import { CommonUserLinkingUseCase } from "./common-user-linking.use-case";

/**
 * リファクタリング指示書 Phase 2: `AccountsService`から分離した
 * Common User Hub連携責務 (common_user_id解決・保存、紐付け後の紹介confirm)。
 */
@Injectable()
export class CommonUserLinkingService {
  private readonly logger = new Logger(CommonUserLinkingService.name);

  constructor(
    private readonly commonUserHub: CommonUserHubClient,
    private readonly referrals: ReferralsService,
    private readonly linking: CommonUserLinkingUseCase,
  ) {}

  /**
   * 代理店システム内共通顧客HUBへcommon_user_idを解決・保存する
   * (外部開発者向け連携ガイド9.1章)。`ENABLE_PLATFORM_USER_ID`無効時や
   * 送信APIキー未設定時はCommonUserHubClient側で自動的にno-opになる。
   * 外部HTTP呼び出しをDBトランザクション内に含めない (接続保持・タイムアウトを
   * 避けるため)。ベストエフォートのため失敗しても登録自体は成功済みのまま返す。
   *
   * 追加整合性対策P0-1: 保存の排他制御・競合判定は`CommonUserLinkingUseCase`
   * (`common_user.resolved`イベント経由の`CommonUserResolvedHandler`と共通) に委ねる。
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

      const linkResult = await this.linking.link({
        accountId: account.id,
        commonUserId: result.commonUserId,
        actorType: "SYSTEM",
      });
      if (linkResult.action === "conflict_requires_review") {
        this.logger.warn(
          `common_user_id ${result.commonUserId} could not be linked to account ${account.id} (conflict)`,
        );
        return;
      }

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
