import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import type { OutboxDestinationHandler, OutboxEvent } from "../outbox/outbox.service";
import { ReferralsService } from "./referrals.service";
import { AccountRepository } from "../accounts/account.repository";

/**
 * `IntegrationOutbox`の`destinationService: "AGENCY_SYSTEM"`宛イベント
 * (`wallet.referral.registered`、`ReferralsService.attachToNewAccount`が登録) の
 * 送信ハンドラ。登録するだけで実送信していなかった不備 (千ノ国 全システム横断連携分析
 * H章シナリオ#12「ウォレット紹介Outboxに登録するが送信ワーカーなし」) の解消。
 *
 * イベント本文 (登録当時のスナップショット) は使わず、`aggregateId` (WalletReferral.id)
 * からDBの最新状態を読み直して`AgencyReferralClient.confirm`を再試行する。
 * common_user_id解決前など「まだ確定できない」状態は例外を投げて
 * `OutboxService`の指数バックオフ再送に乗せ、確定・否認・対象外は成功として扱う。
 */
@Injectable()
export class AgencyReferralOutboxHandler implements OutboxDestinationHandler {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly referrals: ReferralsService,
    private readonly accountRepository: AccountRepository,
  ) {}

  async send(event: OutboxEvent): Promise<void> {
    if (event.eventType !== "wallet.referral.registered") {
      throw new Error(`AgencyReferralOutboxHandler: unsupported event_type "${event.eventType}"`);
    }

    const referral = await this.db.walletReferral.findUnique({ where: { id: event.aggregateId } });
    if (!referral || !referral.walletUserId) return; // 対象アカウントが無い (登録競合で他リクエストが処理済み)
    if (referral.status !== "PENDING") return; // 既にCONFIRMED/REJECTED等、再送不要

    const account = await this.accountRepository.findById(referral.walletUserId);
    if (!account?.commonUserId) {
      throw new Error("common_user_id is not resolved yet for this account; retry later");
    }

    await this.referrals.retryConfirmViaOutbox(referral.walletUserId, account.commonUserId);
  }
}
