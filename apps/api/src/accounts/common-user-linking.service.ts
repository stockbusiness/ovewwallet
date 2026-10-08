import { Injectable, Logger } from "@nestjs/common";
import type { OveAccount } from "@ove/database";
import { CommonUserHubClient } from "../common-user-hub/common-user-hub.client";
import { ReferralsService } from "../referrals/referrals.service";
import { CommonUserLinkingUseCase } from "./common-user-linking.use-case";

/**
 * 共通ID解決の結果。登録時はベストエフォートで握り潰すが、管理画面から
 * 手動で再解決するときは**何が起きたかを呼び出し元へ返す**必要がある
 * (「静かに失敗」したままでは、運用者が設定の誤りに気づけない)。
 */
export type ResolveCommonUserOutcome =
  /** HUBが返したIDを新たに紐付けた。 */
  | { outcome: "linked"; commonUserId: string }
  /** 既に同じIDが紐付いていた (再実行しても安全)。 */
  | { outcome: "already_linked"; commonUserId: string }
  /** 別アカウントに同じIDが紐付いている等。自動では解決しない。 */
  | { outcome: "conflict"; commonUserId: string }
  /** Feature Flag OFF、または送信先・APIキー未設定でHUBを呼んでいない。 */
  | { outcome: "not_configured" }
  /** HUBは呼んだが応答が得られなかった (通信エラー・認証エラー等)。 */
  | { outcome: "hub_unavailable" }
  /** 例外。`message`は画面に出す。 */
  | { outcome: "failed"; message: string };

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
    const result = await this.resolveAndLink(account, "SYSTEM");
    if (result.outcome === "conflict") {
      this.logger.warn(
        `common_user_id ${result.commonUserId} could not be linked to account ${account.id} (conflict)`,
      );
    }
    if (result.outcome === "failed") {
      this.logger.warn(`failed to link common_user_id for account ${account.id}: ${result.message}`);
    }
  }

  /**
   * 共通IDを解決して紐付け、**結果を返す**。
   *
   * `tryLinkCommonUser`は登録時にしか呼ばれず、失敗しても登録は成功する
   * 設計のため、HUBの設定が誤っていると「静かに失敗」したアカウントが
   * 残り続ける (あとから解決し直す手段が無い)。管理画面から手動で再解決
   * できるよう、同じ処理を結果付きで公開する。
   *
   * `actorType`は監査ログ上の実行主体。登録時の自動実行は`SYSTEM`、
   * 管理画面からの手動実行は`ADMIN`を渡す。
   */
  async resolveAndLink(
    account: OveAccount,
    actorType: "SYSTEM" | "ADMIN",
    actorId?: string,
  ): Promise<ResolveCommonUserOutcome> {
    try {
      const result = await this.commonUserHub.resolve({
        externalUserId: account.id,
        email: account.primaryEmail,
        phone: account.primaryPhone,
        displayName: account.displayName,
      });
      // Flag OFF・設定未投入・HUB側エラーのいずれでも`null`が返る
      // (`CommonUserHubAdapter.resolve`)。設定の有無で区別して返す。
      if (!result) {
        return (await this.commonUserHub.isConfigured())
          ? { outcome: "hub_unavailable" }
          : { outcome: "not_configured" };
      }

      const linkResult = await this.linking.link({
        accountId: account.id,
        commonUserId: result.commonUserId,
        actorType,
        actorId,
      });
      if (linkResult.action === "conflict_requires_review") {
        return { outcome: "conflict", commonUserId: result.commonUserId };
      }

      // 紹介Phase 2 (共通実装契約5章): 「本人ログイン・common user resolve後にconfirmする」。
      // ベストエフォート (失敗しても登録・ログイン自体はブロックしない)。
      await this.referrals.confirmAfterCommonUserResolve(account.id, result.commonUserId);

      return linkResult.action === "already_linked"
        ? { outcome: "already_linked", commonUserId: result.commonUserId }
        : { outcome: "linked", commonUserId: result.commonUserId };
    } catch (error) {
      return {
        outcome: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
