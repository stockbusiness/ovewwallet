import { Injectable, Logger } from "@nestjs/common";
import type { OveAccount, Prisma, WalletUserReferral } from "@ove/database";
import { WalletUserReferralRepository } from "./wallet-user-referral.repository";

/**
 * 新規アカウント作成と同一トランザクション内で、ウォレット紹介を成立させる。
 *
 * ## 代理店紹介を上書きしない
 *
 * 代理店紹介 (`WalletReferral`) が先に成立している人を、ウォレット紹介で
 * 奪わない。`OveAccount.registrationReferrerAgencyId` は「一度設定したら
 * 上書きしない」ロックが掛かっており (schema.prisma・
 * `CustomerAssignmentChangedHandler`)、その方針をウォレット紹介側でも守る。
 *
 * 判定は**この時点で分かることだけ**で行う。新規登録の瞬間なので、
 * 代理店紹介があるならそれは同じリクエストで紐付けられる側 (呼び出し元が
 * どちらを実行するか決める) で、`registrationReferrerAgencyId` は
 * イベント受信で後から入る値なので、ここでは常にnullになる。
 * そのため「代理店紹介Cookieも一緒に来ていたか」を呼び出し元から受け取る。
 */
@Injectable()
export class AttachWalletUserReferralUseCase {
  private readonly logger = new Logger(AttachWalletUserReferralUseCase.name);

  constructor(private readonly referrals: WalletUserReferralRepository) {}

  async attachToNewAccount(
    tx: Prisma.TransactionClient,
    referral: WalletUserReferral,
    account: OveAccount,
  ): Promise<void> {
    const now = new Date();

    // 自分のリンクから自分が登録することは通常起こらない (紹介者は既に登録済みで、
    // 既存ユーザーのログインではこのフックが呼ばれない)。それでも、identityを
    // 作り直した等の経路で万一一致したら紹介としては成立させない。
    if (referral.referrerAccountId === account.id) {
      await this.referrals.markExcluded(tx, referral.id, "self_referral", now);
      this.logger.warn(`wallet user referral ${referral.id}: self referral, excluded`);
      return;
    }

    const claimed = await this.referrals.claimCapturedForAccount(tx, referral.id, account.id, now);
    if (claimed.count === 0) {
      // 同一Cookieでの並行リクエストで他方が先に消費した。紹介なしの通常登録として
      // 続ける (代理店紹介の`AttachReferralToAccountUseCase`と同じ方針)。
      this.logger.warn("wallet user referral attach: lost race to a concurrent request");
    }
  }

  /**
   * 代理店紹介が優先されたため、このウォレット紹介は使わないことを記録する。
   * セッションを`CAPTURED`のまま残すと、次のログインで拾われて別のアカウントに
   * 紐付きうるため、使い切りとして閉じる。
   */
  async excludeForAgencyReferral(
    tx: Prisma.TransactionClient,
    referral: WalletUserReferral,
  ): Promise<void> {
    await this.referrals.markExcluded(tx, referral.id, "agency_referral_takes_precedence", new Date());
    this.logger.log(
      `wallet user referral ${referral.id}: excluded because an agency referral was attached instead`,
    );
  }
}
