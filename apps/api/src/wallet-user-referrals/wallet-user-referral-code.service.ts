import { Inject, Injectable } from "@nestjs/common";
import { generateOpaqueToken } from "@ove/auth";
import { Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

/**
 * 紹介コードの長さ。URLに載って人づてに共有される値なので、総当たりで他人の
 * コードを引き当てられない程度の長さを確保する (16バイト = 128bit相当)。
 */
const REFERRAL_CODE_BYTES = 16;

/** 一意制約違反での再試行回数。衝突確率は無視できるが、無限ループにはしない。 */
const MAX_ISSUE_ATTEMPTS = 3;

/**
 * ウォレット利用者の紹介コードを発行・保持する。
 *
 * 全員に前もって振らず、**本人が紹介画面を開いた時点で発行する**
 * (使わない人のほうが多い想定で、発行済みの値を無駄に増やさない)。
 * 一度発行したコードは変えない (共有済みのURLが死ぬため)。
 */
@Injectable()
export class WalletUserReferralCodeService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /**
   * 本人の紹介コードを返す。未発行なら発行して返す (冪等)。
   *
   * 既に発行済みかどうかを読んでから書くため、同一アカウントへの並行呼び出しでは
   * 両方が「未発行」と判定しうる。その場合は2件目が一意制約で失敗するので、
   * 失敗したら再読み込みして先に入った値を返す (`findOrCreateByIdentity`の
   * P2002リトライと同じ考え方)。
   */
  async ensureCode(accountId: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_ISSUE_ATTEMPTS; attempt += 1) {
      const account = await this.db.oveAccount.findUniqueOrThrow({
        where: { id: accountId },
        select: { walletReferralCode: true },
      });
      if (account.walletReferralCode) return account.walletReferralCode;

      const code = generateOpaqueToken(REFERRAL_CODE_BYTES);
      try {
        const updated = await this.db.oveAccount.update({
          where: { id: accountId },
          data: { walletReferralCode: code },
          select: { walletReferralCode: true },
        });
        return updated.walletReferralCode!;
      } catch (error) {
        // 発行済みの値との衝突 (= 並行呼び出し、またはコード自体の衝突) のときだけ
        // 読み直して再試行する。それ以外は呼び出し元へ投げる。
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
      }
    }

    // 3回とも衝突した場合。読み直して入っていればそれを使う。
    const account = await this.db.oveAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { walletReferralCode: true },
    });
    if (account.walletReferralCode) return account.walletReferralCode;
    throw new Error(`failed to issue a wallet referral code for account ${accountId}`);
  }
}
