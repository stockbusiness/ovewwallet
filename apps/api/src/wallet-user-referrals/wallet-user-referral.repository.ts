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

  /**
   * 管理画面向け: このアカウントが紹介した関係を**状態で絞らずに**返す。
   *
   * 本人向けの`listByReferrer`はREGISTERED/INHERITEDだけを返すが、運用では
   * 逆に`EXCLUDED`・`EXPIRED`こそ見たい (「紹介したはずなのに数に入らない」という
   * 問い合わせの答えがそこにある)。登録前セッション (CAPTURED) は紹介リンクを
   * 開かれた回数にすぎず、人として数えられないため除く。
   */
  async listByReferrerForAdmin(referrerAccountId: string, limit = 200) {
    return this.db.walletUserReferral.findMany({
      where: { referrerAccountId, status: { not: "CAPTURED" } },
      orderBy: { capturedAt: "desc" },
      take: limit,
      include: {
        referred: {
          select: { id: true, accountCode: true, displayName: true, registrationReferrerAgencyId: true },
        },
      },
    });
  }

  /** 管理画面向け: このアカウントを紹介した関係 (最大1件)。 */
  async findByReferredForAdmin(referredAccountId: string) {
    return this.db.walletUserReferral.findUnique({
      where: { referredAccountId },
      include: { referrer: { select: { id: true, accountCode: true, displayName: true } } },
    });
  }

  /**
   * 継承申請の対象。紹介者が代理店資格を取得したときに拾う。
   *
   * 条件は「成立済み (`REGISTERED`) で、まだ申請を送っていない (`inheritedAt`が
   * null) もの」。`INHERITED`は申請済みを表すため対象外。
   */
  async listPendingInheritance(referrerAccountId: string, limit = 500) {
    return this.db.walletUserReferral.findMany({
      where: { referrerAccountId, status: "REGISTERED", inheritedAt: null },
      orderBy: { capturedAt: "asc" },
      take: limit,
      include: { referred: { select: { id: true, commonUserId: true } } },
    });
  }

  /**
   * 申請を送ったことを記録する。`inheritedAt`が入っている行は
   * `listPendingInheritance`が拾わないため、同じ紹介を二重に申請しない。
   */
  async markInheritanceRequested(
    tx: Prisma.TransactionClient,
    id: string,
    now: Date,
  ): Promise<{ count: number }> {
    return tx.walletUserReferral.updateMany({
      where: { id, status: "REGISTERED", inheritedAt: null },
      data: { status: "INHERITED", inheritedAt: now },
    });
  }

  /** 紹介コードからアカウントを引く。 */
  async findAccountByReferralCode(code: string, db: Db = this.db) {
    return db.oveAccount.findUnique({ where: { walletReferralCode: code } });
  }
}
