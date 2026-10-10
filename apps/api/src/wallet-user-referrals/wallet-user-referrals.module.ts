import { Module, type OnModuleInit } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module";
import { OutboxModule } from "../outbox/outbox.module";
import { OutboxService } from "../outbox/outbox.service";
import { AttachWalletUserReferralUseCase } from "./attach-wallet-user-referral.use-case";
import { RequestInheritanceUseCase } from "./request-inheritance.use-case";
import { WalletUserReferralCaptureUseCase } from "./wallet-user-referral-capture.use-case";
import { WalletUserReferralCodeService } from "./wallet-user-referral-code.service";
import { WalletUserReferralInheritanceOutboxHandler } from "./wallet-user-referral-inheritance-outbox-handler";
import { WalletUserReferralRepository } from "./wallet-user-referral.repository";
import { WalletUserReferralsController } from "./wallet-user-referrals.controller";
import { WalletUserReferralsService } from "./wallet-user-referrals.service";

@Module({
  imports: [OutboxModule, IntegrationsModule],
  controllers: [WalletUserReferralsController],
  providers: [
    WalletUserReferralRepository,
    WalletUserReferralCodeService,
    WalletUserReferralCaptureUseCase,
    AttachWalletUserReferralUseCase,
    RequestInheritanceUseCase,
    WalletUserReferralInheritanceOutboxHandler,
    WalletUserReferralsService,
  ],
  // AdminModule の可視化画面と AgencyService (昇格検知) から使う。
  exports: [WalletUserReferralsService, WalletUserReferralRepository, RequestInheritanceUseCase],
})
export class WalletUserReferralsModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly inheritanceHandler: WalletUserReferralInheritanceOutboxHandler,
  ) {}

  /**
   * `wallet.referral.inheritance.requested` の送信ハンドラを登録する。
   *
   * 宛先 `AGENCY_SYSTEM` の既定ハンドラは `ReferralsModule` が
   * `wallet.referral.registered` 用に登録済みなので、event_type単位で登録して
   * 上書きを避ける (`OutboxService.registerEventHandler`)。
   */
  onModuleInit(): void {
    this.outbox.registerEventHandler(
      "AGENCY_SYSTEM",
      "wallet.referral.inheritance.requested",
      this.inheritanceHandler,
    );
  }
}
