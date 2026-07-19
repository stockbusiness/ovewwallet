import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";

/** 7日サイクルの継続ログインボーナス額 (1〜7日目、8日目以降は繰り返す)。 */
const DAILY_BONUS_SCHEDULE = [10n, 10n, 20n, 20n, 30n, 30n, 50n];

function amountForStreak(streak: number): bigint {
  return DAILY_BONUS_SCHEDULE[(streak - 1) % DAILY_BONUS_SCHEDULE.length]!;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isNextDay(previous: Date, current: Date): boolean {
  const diffMs = startOfDay(current).getTime() - startOfDay(previous).getTime();
  return diffMs === 24 * 60 * 60 * 1000;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * 継続ログイン(デイリー)ボーナス。1アカウント・1暦日につき1回のみ請求できる。
 * 前日分の請求が無ければ streak は1にリセットされる (docs/daily-login-bonus.md参照)。
 */
@Injectable()
export class DailyBonusService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** 請求せずに現在の状態 (本日請求済みか・streak・次回請求時の金額) だけを返す。 */
  async getStatus(oveAccountId: string) {
    const today = startOfDay(new Date());
    const latest = await this.db.dailyBonusClaim.findFirst({
      where: { oveAccountId },
      orderBy: { claimedDate: "desc" },
    });

    const claimedToday = latest ? startOfDay(latest.claimedDate).getTime() === today.getTime() : false;
    const currentStreak = latest?.streakCount ?? 0;
    const nextStreak = claimedToday
      ? currentStreak
      : latest && isNextDay(latest.claimedDate, today)
        ? currentStreak + 1
        : 1;

    return {
      claimed_today: claimedToday,
      current_streak: currentStreak,
      next_streak: nextStreak,
      next_amount: amountForStreak(nextStreak).toString(),
    };
  }

  /**
   * 受け取り履歴カレンダー用 (docs/daily-login-bonus.md参照)。直近90日分の請求記録を
   * 新しい順で返す。連続していない日はレコード自体が存在しない (「飛んだ日」は
   * クライアント側で日付の抜けとして表現する)。
   */
  async getHistory(oveAccountId: string) {
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const claims = await this.db.dailyBonusClaim.findMany({
      where: { oveAccountId, claimedDate: { gte: startOfDay(since) } },
      orderBy: { claimedDate: "desc" },
    });

    return claims.map((c) => ({
      claimed_date: c.claimedDate.toISOString().slice(0, 10),
      streak_count: c.streakCount,
      amount: c.amount.toString(),
    }));
  }

  /** 本日分を請求する。既に本日分を請求済みなら409。 */
  async claim(oveAccountId: string) {
    const wallet = await this.db.wallet.findUnique({ where: { oveAccountId } });
    if (!wallet) throw new NotFoundException("wallet not found for this account");

    const today = startOfDay(new Date());
    const latest = await this.db.dailyBonusClaim.findFirst({
      where: { oveAccountId },
      orderBy: { claimedDate: "desc" },
    });

    if (latest && startOfDay(latest.claimedDate).getTime() === today.getTime()) {
      throw new ConflictException("daily bonus already claimed today");
    }

    const streak = latest && isNextDay(latest.claimedDate, today) ? latest.streakCount + 1 : 1;
    const amount = amountForStreak(streak);
    const dateStr = today.toISOString().slice(0, 10);

    const transaction = await creditWallet(
      {
        walletId: wallet.id,
        amount,
        transactionType: "DAILY_LOGIN_BONUS",
        idempotencyKey: `DAILY_LOGIN_BONUS:${oveAccountId}:${dateStr}`,
        displayName: "継続ログインボーナス",
        description: `${streak}日連続ログイン`,
        createdByType: "SYSTEM",
      },
      this.db,
    );

    try {
      await this.db.dailyBonusClaim.create({
        data: {
          id: generateId(),
          oveAccountId,
          claimedDate: today,
          streakCount: streak,
          amount,
          transactionId: transaction.id,
        },
      });
    } catch (err) {
      // 同時押し等でユニーク制約違反した場合、creditWalletの冪等キーが既に二重付与を
      // 防いでいるため、負けた側はclaimレコード作成を諦めるだけでよい。
      if (!isUniqueConstraintError(err)) throw err;
    }

    return {
      claimed_today: true,
      current_streak: streak,
      amount: amount.toString(),
    };
  }
}
