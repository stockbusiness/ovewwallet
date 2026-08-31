import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import type {
  CurrentLiability,
  ExpiryForecastBucket,
  LiabilityMovement,
  LiabilityRollForwardPeriod,
} from "./point-liability.types";

/** 失効見込みを出す期間 (日)。 */
export const EXPIRY_FORECAST_DAYS = [30, 60, 90];

/**
 * 残高を動かさない取引種別。
 *
 * HOLD/RELEASE は available と held の間を移動するだけで、両者の合計 (= 負債) は
 * 変わらない。ACCOUNT_MERGE_IN/OUT はウォレット間の振替で、全社合計では相殺される。
 * どちらも増減表に載せると発行・利用の両方が実態より膨らむため除外する。
 */
const BALANCE_NEUTRAL_TYPES = ["HOLD", "RELEASE", "ACCOUNT_MERGE_IN", "ACCOUNT_MERGE_OUT"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 増減の純額。`期首 + これ = 期末` が成り立つ。 */
function netMovement(m: LiabilityMovement): bigint {
  return (
    BigInt(m.issued) -
    BigInt(m.used) -
    BigInt(m.expired) -
    BigInt(m.reversedIssuance) +
    BigInt(m.reversedUsage) +
    BigInt(m.otherIncrease) -
    BigInt(m.otherDecrease)
  );
}

/** `YYYY-MM` 表記。JSTの暦月で切る。 */
function periodKey(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

/** JSTのその月の初日 00:00 をUTCで表した時刻。 */
function jstMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - 9 * 60 * 60 * 1000);
}

/** JSTの月末日 (DATE列に入れる暦日)。 */
function jstMonthEndDate(year: number, month: number): Date {
  // 翌月1日の1日前。UTCのDATEとして保存するため時刻は持たせない。
  return new Date(Date.UTC(year, month, 0));
}

function parsePeriod(period: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`invalid period: ${period} (expected YYYY-MM)`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * ポイント負債 (発行済み未使用残高) のレポート。
 *
 * 導入前は、管理ダッシュボードに「今日の付与・利用」と過去30日の推移はあったが、
 * **現時点でいくら発行済みで未使用なのか**という会計上いちばん必要な数字を出す手段が
 * どこにも無かった。
 *
 * ## 負債の定義
 *
 * `SUM(available_balance + held_balance)`。保留中(held)は管理者が一時的に凍結して
 * いるだけで利用者への債務は残っているため含める。
 *
 * `pending_balance`・`recovery_balance` は含めない。**台帳のどのコードパスからも
 * 書かれておらず常に0**の未使用列のため (`packages/ledger/src/`を全て確認済み)。
 * これらを使い始めるときは、この定義を見直すこと。
 *
 * ## 月次増減表 (ロールフォワード)
 *
 * `期首 + 発行 − 利用 − 失効 − 発行取消 + 利用取消 ± その他 = 期末` が成り立つことを、期末のスナップショットに
 * 対して毎回検算する。差 (`discrepancy`) が0でなければ、台帳を経由しない残高変更が
 * あることを意味する (整合性チェック `AdminService.reconcile()` と同じ考え方の、
 * 期間版の検算)。
 *
 * 取引 (`ove_transactions`) はDBトリガーで不変・追記のみで、取消は取消日の新しい行に
 * なるため、過去月の数字は後から動かない。スナップショットを保存するのは、期首残高を
 * 出すのに全期間を遡らずに済ませるため (性能) と、上記の検算の基準を持つため。
 */
@Injectable()
export class PointLiabilityService {
  private readonly logger = new Logger(PointLiabilityService.name);

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** 現時点の負債残高と失効見込み。 */
  async getCurrentLiability(now: Date = new Date()): Promise<CurrentLiability> {
    const [totals, walletsWithBalance, expiringBalance] = await Promise.all([
      this.db.wallet.aggregate({ _sum: { availableBalance: true, heldBalance: true } }),
      this.db.wallet.count({ where: { OR: [{ availableBalance: { gt: 0n } }, { heldBalance: { gt: 0n } }] } }),
      this.sumLiveLots(now),
    ]);

    const available = totals._sum.availableBalance ?? 0n;
    const held = totals._sum.heldBalance ?? 0n;

    return {
      asOf: now.toISOString(),
      totalBalance: (available + held).toString(),
      availableBalance: available.toString(),
      heldBalance: held.toString(),
      expiringBalance: expiringBalance.toString(),
      walletsWithBalance,
      expiryForecast: await this.buildExpiryForecast(now),
    };
  }

  /** 有効期限付きで、まだ失効も取消もされていないロットの残高合計。 */
  private async sumLiveLots(now: Date, expiresBefore?: Date): Promise<bigint> {
    const result = await this.db.oveCreditLot.aggregate({
      _sum: { remainingAmount: true },
      where: {
        expiredAt: null,
        voidedAt: null,
        remainingAmount: { gt: 0n },
        ...(expiresBefore ? { expiresAt: { gt: now, lte: expiresBefore } } : {}),
      },
    });
    return result._sum.remainingAmount ?? 0n;
  }

  private async buildExpiryForecast(now: Date): Promise<ExpiryForecastBucket[]> {
    return Promise.all(
      EXPIRY_FORECAST_DAYS.map(async (withinDays) => ({
        withinDays,
        amount: (await this.sumLiveLots(now, new Date(now.getTime() + withinDays * DAY_MS))).toString(),
      })),
    );
  }

  /**
   * 直近`months`か月の増減表。新しい月が先頭。
   * 当月は途中経過として、期末に集計時点の実残高を入れる。
   */
  async getRollForward(months: number, now: Date = new Date()): Promise<LiabilityRollForwardPeriod[]> {
    const current = parsePeriod(periodKey(now));
    const periods: Array<{ year: number; month: number }> = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(current.year, current.month - 1 - i, 1));
      periods.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
    }

    // 期首は「前月末のスナップショット」なので、いちばん古い月の前月も引く。
    const oldest = periods[periods.length - 1]!;
    const snapshots = await this.db.pointLiabilitySnapshot.findMany({
      where: { periodEnd: { gte: jstMonthEndDate(oldest.year, oldest.month - 1) } },
    });
    const snapshotByPeriod = new Map(
      snapshots.map((s) => [s.periodEnd.toISOString().slice(0, 7), s]),
    );

    const liveBalance = await this.sumWalletBalances();

    return Promise.all(
      periods.map(async ({ year, month }) => {
        const period = `${year}-${String(month).padStart(2, "0")}`;
        const start = jstMonthStart(year, month);
        const end = jstMonthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);

        const movement = await this.sumMovement(start, end);
        const previous = new Date(Date.UTC(year, month - 2, 1));
        const openingSnapshot = snapshotByPeriod.get(
          `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`,
        );
        const closingSnapshot = snapshotByPeriod.get(period);

        const openingBalance = openingSnapshot ? openingSnapshot.totalBalance : null;
        const closingBalance = closingSnapshot ? closingSnapshot.totalBalance : liveBalance;
        const net = netMovement(movement);

        return {
          period,
          openingBalance: openingBalance?.toString() ?? null,
          movement,
          closingBalance: closingBalance.toString(),
          closingSource: closingSnapshot ? ("snapshot" as const) : ("live" as const),
          // 期首が無い月 (遡れる範囲の最初) は検算できないので0とする。
          discrepancy:
            openingBalance === null ? "0" : (closingBalance - (openingBalance + net)).toString(),
        };
      }),
    );
  }

  private async sumWalletBalances(): Promise<bigint> {
    const totals = await this.db.wallet.aggregate({
      _sum: { availableBalance: true, heldBalance: true },
    });
    return (totals._sum.availableBalance ?? 0n) + (totals._sum.heldBalance ?? 0n);
  }

  /**
   * 期間内の増減を会計区分ごとに集計する。
   *
   * 種別を列挙して分類するのではなく、**direction (CREDIT/DEBIT) を基準に**して
   * 例外だけを名前で拾う。種別は今後も増えるため、列挙方式だと新しい種別が
   * どの区分にも入らず、合計だけが静かにずれるため。
   */
  private async sumMovement(start: Date, end: Date): Promise<LiabilityMovement> {
    const rows = await this.db.oveTransaction.groupBy({
      by: ["transactionType", "direction"],
      _sum: { amount: true },
      where: {
        occurredAt: { gte: start, lt: end },
        // REVERSED を含めるのが要点。取消されると**元の取引**の status が REVERSED に
        // 変わる (`packages/ledger/src/reversal.ts`) が、その取引は発生時に確かに残高を
        // 動かしている。COMPLETED だけで絞ると、取消された付与が「発行」から消える一方で
        // 取消の行だけが残り、増減の合計が実際の残高の動きと合わなくなる。
        // 取消は取消日の別の行として計上されるため、二重計上にはならない。
        // PENDING/FAILED は残高を動かしていないので除く。
        status: { in: ["COMPLETED", "REVERSED"] },
        transactionType: { notIn: [...BALANCE_NEUTRAL_TYPES] },
      },
    });

    let issued = 0n;
    let used = 0n;
    let expired = 0n;
    let reversedIssuance = 0n;
    let reversedUsage = 0n;
    let otherIncrease = 0n;
    let otherDecrease = 0n;

    for (const row of rows) {
      const amount = row._sum.amount ?? 0n;
      const isCredit = row.direction === "CREDIT";

      if (row.transactionType === "EXPIRATION") {
        expired += amount;
      } else if (row.transactionType === "REVERSAL") {
        // CREDITの取消はDEBITとして記録される (負債が減る)。逆も同様。
        if (isCredit) reversedUsage += amount;
        else reversedIssuance += amount;
      } else if (row.transactionType === "BLOCKCHAIN_MIGRATION" || row.transactionType === "MIGRATION_REVERSAL") {
        // オンチェーン移行はこの台帳から負債が外に出る動き。利用とは意味が違うため分ける。
        if (isCredit) otherIncrease += amount;
        else otherDecrease += amount;
      } else if (isCredit) {
        issued += amount;
      } else {
        used += amount;
      }
    }

    return {
      issued: issued.toString(),
      used: used.toString(),
      expired: expired.toString(),
      reversedIssuance: reversedIssuance.toString(),
      reversedUsage: reversedUsage.toString(),
      otherIncrease: otherIncrease.toString(),
      otherDecrease: otherDecrease.toString(),
    };
  }

  /**
   * 指定月の月末スナップショットを保存する (同じ月は上書きしない)。
   *
   * 記録するのは「集計時点の実残高」ではなく**月末時点の残高**。実残高から月末以降の
   * 増減を差し引いて求めるため、ジョブが月初に走っても数日遅れて走っても同じ値になる
   * (過去月の後追い記録にも使える)。取引は不変・追記のみなので、この引き算は
   * 何度計算しても同じ結果になる。
   */
  async captureMonthEndSnapshot(period: string, now: Date = new Date()): Promise<{ created: boolean }> {
    const { year, month } = parsePeriod(period);
    const periodEnd = jstMonthEndDate(year, month);
    // 月末の締め時刻 = 翌月1日 00:00 JST (この時刻より前の取引までが対象)。
    const periodBoundary = jstMonthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);

    if (periodBoundary > now) {
      // まだ終わっていない月は締められない。
      throw new Error(`period ${period} has not ended yet`);
    }

    const existing = await this.db.pointLiabilitySnapshot.findUnique({ where: { periodEnd } });
    if (existing) {
      // 一度確定した月の数字は動かさない。会計は締めた値が変わらないことを前提にする。
      this.logger.log(`point liability snapshot for ${period} already exists; skipped`);
      return { created: false };
    }

    const balanceAtCapture = await this.sumWalletBalances();
    const movementAfterPeriod = netMovement(await this.sumMovement(periodBoundary, now));
    const totalBalance = balanceAtCapture - movementAfterPeriod;

    await this.db.pointLiabilitySnapshot.create({
      data: {
        id: generateId(),
        periodEnd,
        totalBalance,
        balanceAtCapture,
        movementAfterPeriod,
      },
    });
    this.logger.log(
      `point liability snapshot for ${period}: total=${totalBalance} (capture=${balanceAtCapture} after=${movementAfterPeriod})`,
    );
    return { created: true };
  }

  /** 前月の`YYYY-MM`。月次ジョブが「締まった直近の月」を対象にするために使う。 */
  static previousPeriod(now: Date = new Date()): string {
    const { year, month } = parsePeriod(periodKey(now));
    const d = new Date(Date.UTC(year, month - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
}
