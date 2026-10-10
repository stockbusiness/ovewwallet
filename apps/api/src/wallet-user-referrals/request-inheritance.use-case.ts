import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { AgencyReferralInheritanceAdapter } from "../integrations/agency-referral-inheritance.adapter";
import { OutboxService } from "../outbox/outbox.service";
import { WalletUserReferralRepository } from "./wallet-user-referral.repository";

export interface RequestInheritanceResult {
  /** Outboxへ積んだ申請の件数。 */
  requested: number;
  /** 共通ID未解決などで申請できなかった件数。 */
  skipped: number;
}

/**
 * 紹介者が代理店資格を取得したときに、それまでのウォレット紹介を代理店システムへ
 * 継承申請する (`docs/wallet-user-referral.md` Phase 2)。
 *
 * ## 昇格の検知
 *
 * 代理店同期 (`POST /api/v1/agency`) が運んでくる `common_user_id` が、既存の
 * ウォレットアカウントと一致したときに呼ぶ。代理店システム側で「初回の資格取得」を
 * 区別できる通知を追加する調整が進んでいるが、**その値が確定していなくても
 * この形で動く**: 申請済みの行は `inherited_at` で除外されるため、情報更新の同期が
 * 何度届いても二重に申請しない。区別用の通知が入ったら条件を絞るだけでよい。
 *
 * ## 送れないときは何もしない
 *
 * Flag・送信設定・受信パスのいずれかが欠けていれば、**Outboxに積まない**。
 * 積んでから失敗させると、受信パスが決まるまで再送上限 (8回) を使い切って
 * FAILEDが並び、本当の失敗と区別できなくなるため。
 */
@Injectable()
export class RequestInheritanceUseCase {
  private readonly logger = new Logger(RequestInheritanceUseCase.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly referrals: WalletUserReferralRepository,
    private readonly inheritance: AgencyReferralInheritanceAdapter,
    private readonly outbox: OutboxService,
  ) {}

  async requestForReferrer(referrerAccountId: string): Promise<RequestInheritanceResult> {
    if (!(await this.inheritance.isReady())) return { requested: 0, skipped: 0 };

    const referrer = await this.db.oveAccount.findUnique({
      where: { id: referrerAccountId },
      select: { commonUserId: true },
    });
    // 紹介者の共通IDが未解決では申請できない (先方の受信項目に含まれる)。
    // 管理画面の「共通IDを再解決」で埋めたあと、次の同期で拾われる。
    if (!referrer?.commonUserId) {
      this.logger.warn(
        `wallet referral inheritance: referrer ${referrerAccountId} has no common_user_id yet; skipped`,
      );
      return { requested: 0, skipped: 0 };
    }

    const pending = await this.referrals.listPendingInheritance(referrerAccountId);
    let requested = 0;
    let skipped = 0;

    for (const row of pending) {
      const referredCommonUserId = row.referred?.commonUserId;
      if (!referredCommonUserId) {
        skipped += 1;
        continue;
      }

      // 状態更新とOutbox登録を同一トランザクションに入れる (開発ガイドライン10章)。
      // 片方だけ成功すると、申請済みなのに送られない・送ったのに再送されるの
      // どちらかが起きる。
      await this.db.$transaction(async (tx) => {
        const claimed = await this.referrals.markInheritanceRequested(tx, row.id, new Date());
        if (claimed.count === 0) return; // 並行実行で他方が先に申請した

        await this.outbox.enqueue(tx, {
          eventType: "wallet.referral.inheritance.requested",
          aggregateType: "wallet_user_referral",
          aggregateId: row.id,
          destinationService: "AGENCY_SYSTEM",
          // 先方は source_system_key + referral_record_id で重複を見る。
          // 同じ紹介記録で2件目を作らないよう、キーに紹介記録IDを使う。
          idempotencyKey: `WALLET_REFERRAL_INHERITANCE_REQUESTED:${row.id}`,
          payload: {
            // 「再送時も同じ値」という要件を、保存済みペイロードの再利用に頼らず
            // 値そのもので満たす。紹介記録IDは不変で一意なので、そこから決める。
            event_id: `wri_${row.id}`,
            event_type: "wallet.referral.inheritance.requested",
            referrer_common_user_id: referrer.commonUserId,
            referred_common_user_id: referredCommonUserId,
            referred_at: row.capturedAt.toISOString(),
            referral_record_id: row.id,
          },
        });
        requested += 1;
      });
    }

    if (requested > 0 || skipped > 0) {
      this.logger.log(
        `wallet referral inheritance for ${referrerAccountId}: requested=${requested} skipped=${skipped}`,
      );
    }
    return { requested, skipped };
  }
}
