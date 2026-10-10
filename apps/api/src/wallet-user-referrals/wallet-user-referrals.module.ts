import { Module } from "@nestjs/common";
import { AttachWalletUserReferralUseCase } from "./attach-wallet-user-referral.use-case";
import { WalletUserReferralCaptureUseCase } from "./wallet-user-referral-capture.use-case";
import { WalletUserReferralCodeService } from "./wallet-user-referral-code.service";
import { WalletUserReferralRepository } from "./wallet-user-referral.repository";
import { WalletUserReferralsController } from "./wallet-user-referrals.controller";
import { WalletUserReferralsService } from "./wallet-user-referrals.service";

@Module({
  controllers: [WalletUserReferralsController],
  providers: [
    WalletUserReferralRepository,
    WalletUserReferralCodeService,
    WalletUserReferralCaptureUseCase,
    AttachWalletUserReferralUseCase,
    WalletUserReferralsService,
  ],
  exports: [WalletUserReferralsService],
})
export class WalletUserReferralsModule {}
