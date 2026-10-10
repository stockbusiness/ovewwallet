import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient, WalletUserReferral } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * `wallet_user_referrals` へのアクセスをここに閉じる
 * (`ReferralRepository`と同じ構成。use-case側にPrismaの書き方を散らさない)。
 */
@Injectable()
export class WalletUserReferralRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async create(data: Prisma.WalletUserReferralUncheckedCreateInput): Promise<WalletUserReferral> {
    return this.db.walletUserReferral.create({ data });
  }

  async findBySessionTokenHash(hash: string): Promise<WalletUserReferral | null> {
    return this.db.walletUserReferral.findUnique({ where: { sessionTokenHash: hash } });
  }

  async update(id: string, data: Prisma.WalletUserReferralUncheckedUpdateInput): Promise<WalletUserReferral> {
    return this.db.walletUserReferral.update({ where: { id }, data });
  }

  /** 紹介した側から見た一覧 (本人向け画面・管理画面で共用)。 */
  async listByReferrer(referrerAccountId: string, limit = 100) {
    return this.db.walletUserReferral.findMany({
      where: { referrerAccountId, status: { in: ["REGISTERED", "INHERITED"] } },
      orderBy: { registeredAt: "desc" },
      take: limit,
      include: { referred: { select: { id: true, accountCode: true, displayName: true } } },
    });
  }

  async countByReferrer(referrerAccountId: string): Promise<number> {
    return this.db.walletUserReferral.count({
      where: { referrerAccountId, status: { in: ["REGISTERED", "INHERITED"] } },
    });
  }

  /**
   * 登録完了時に、CAPTUREDのセッションを1件だけREGISTEREDへ進める
   * (`ReferralRepository.claimCapturedForAccount`と同じ条件付き更新による排他)。
   * 同一Cookieでの並行リクエストでは片方しか成功せず、`count === 0` が
   * 「競合に負けた」を意味する。
   */
  async claimCapturedForAccount(
    tx: Prisma.TransactionClient,
    id: string,
    referredAccountId: string,
    now: Date,
  ): Promise<{ count: number }> {
    return tx.walletUserReferral.updateMany({
      where: { id, status: "CAPTURED", usedAt: null, referredAccountId: null },
      data: { status: "REGISTERED", referredAccountId, usedAt: now, registeredAt: now },
    });
  }

  /** 対象外として閉じる (代理店紹介が先に成立していた等)。使い切り扱いにする。 */
  async markExcluded(
    tx: Prisma.TransactionClient,
    id: string,
    reason: string,
    now: Date,
  ): Promise<{ count: number }> {
    return tx.walletUserReferral.updateMany({
      where: { id, status: "CAPTURED", usedAt: null },
      data: { status: "EXCLUDED", usedAt: now, reason },
    });
  }

  /** 紹介コードからアカウントを引く。 */
  async findAccountByReferralCode(code: string, db: Db = this.db) {
    return db.oveAccount.findUnique({ where: { walletReferralCode: code } });
  }
}
