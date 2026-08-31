import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import {
  EXPIRY_NOTICE_CREATED_BY,
  EXPIRY_NOTICE_MAX_ACCOUNTS_PER_RUN,
  expiryNoticeDaysBefore,
} from "./scheduler.config";

export interface ExpiryNoticeResult {
  /** 通知を作成したアカウント数 */
  accountsNotified: number;
  /** 通知済みとして印を付けたロット数 */
  lotsMarked: number;
}

/** 「2026年9月7日」形式。通知文面に埋め込むため、JSTの暦日で表記する。 */
function formatJstDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
  return parts;
}

/**
 * 失効予告の自動生成。
 *
 * 導入前は、失効間近のORIに気づく手段がウォレットホームの警告バナー
 * (`getExpiringCreditsSummary`, 30日以内) だけだった。アプリを開かなければ何も届かず、
 * 失効バッチ (`JOB_CREDIT_EXPIRY`) が黙って残高を減らす形になっていた。
 *
 * このジョブは失効の`EXPIRY_NOTICE_DAYS_BEFORE`日前になったロットを拾い、
 * 本人宛のお知らせ (`Notice.oveAccountId`が設定された個別通知) を作成する。
 *
 * ## 重複を防ぐ方法
 *
 * 毎日実行されるため、同じロットについて毎日通知しないよう
 * `OveCreditLot.expiryNoticeSentAt`に印を付ける。次回以降はこの印がnullのロットだけを
 * 対象にするため、日をまたいでも同じ失効分を再通知しない。
 * 通知の作成と印付けは同一トランザクションで行い、途中で落ちた場合は
 * 「通知は作られたが印は付いていない」状態を作らない。
 *
 * ## 対象外
 *
 * - 退会済み (`CLOSED`) アカウント: 使い切る手段が無いため通知しても意味が無い。
 * - 既に失効済み (`expiredAt`) ・取消済み (`voidedAt`) ・残高0のロット。
 * - 既に失効日を過ぎているロット: 予告としては手遅れで、次の失効バッチで処理される。
 *
 * ## LINE配信について
 *
 * `LineBroadcastService`は全ユーザーへの一斉配信のため、本人宛の通知には使わない
 * (他人の失効額を配信してしまう)。個別配信の口ができたら別途対応する。
 */
@Injectable()
export class ExpiryNoticeService {
  private readonly logger = new Logger(ExpiryNoticeService.name);

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async createExpiryNotices(now: Date = new Date()): Promise<ExpiryNoticeResult> {
    const daysBefore = expiryNoticeDaysBefore();
    const threshold = new Date(now.getTime() + daysBefore * 24 * 60 * 60 * 1000);

    const lots = await this.db.oveCreditLot.findMany({
      where: {
        expiresAt: { gt: now, lte: threshold },
        expiredAt: null,
        voidedAt: null,
        remainingAmount: { gt: 0n },
        expiryNoticeSentAt: null,
        wallet: { account: { status: { not: "CLOSED" } } },
      },
      orderBy: { expiresAt: "asc" },
      select: {
        id: true,
        remainingAmount: true,
        expiresAt: true,
        wallet: { select: { oveAccountId: true } },
      },
    });

    // アカウントごとに1通にまとめる。複数ロットが同時期に失効する場合に、
    // ロットの数だけ通知が届くのを避けるため。
    const byAccount = new Map<string, { lotIds: string[]; total: bigint; earliest: Date }>();
    for (const lot of lots) {
      const accountId = lot.wallet.oveAccountId;
      const entry = byAccount.get(accountId);
      if (entry) {
        entry.lotIds.push(lot.id);
        entry.total += lot.remainingAmount;
        // findManyをexpiresAt昇順で引いているため、最初の1件が最短の失効日になる。
      } else {
        byAccount.set(accountId, {
          lotIds: [lot.id],
          total: lot.remainingAmount,
          earliest: lot.expiresAt,
        });
      }
    }

    let accountsNotified = 0;
    let lotsMarked = 0;

    for (const [oveAccountId, entry] of byAccount) {
      if (accountsNotified >= EXPIRY_NOTICE_MAX_ACCOUNTS_PER_RUN) break;

      const expiresOn = formatJstDate(entry.earliest);
      const amount = entry.total.toLocaleString("ja-JP");

      await this.db.$transaction(async (tx) => {
        await tx.notice.create({
          data: {
            id: generateId(),
            title: "まもなく失効するORIがあります",
            message:
              `${expiresOn}に${amount} ORIの有効期限が切れます。` +
              `期限を過ぎたORIは自動的に失効し、元に戻すことはできません。` +
              `有効期限が近いORIから順に使われますので、お早めにご利用ください。`,
            status: "PUBLISHED",
            importance: "IMPORTANT",
            oveAccountId,
            createdBy: EXPIRY_NOTICE_CREATED_BY,
          },
        });
        await tx.oveCreditLot.updateMany({
          where: { id: { in: entry.lotIds } },
          data: { expiryNoticeSentAt: now },
        });
      });

      accountsNotified++;
      lotsMarked += entry.lotIds.length;
    }

    if (accountsNotified > 0) {
      this.logger.log(
        `expiry notices created: accounts=${accountsNotified} lots=${lotsMarked} (days_before=${daysBefore})`,
      );
    }
    return { accountsNotified, lotsMarked };
  }
}
