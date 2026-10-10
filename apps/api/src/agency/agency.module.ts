import { Module } from "@nestjs/common";
import { WalletUserReferralsModule } from "../wallet-user-referrals/wallet-user-referrals.module";
import { AgencyController } from "./agency.controller";
import { AgencyService } from "./agency.service";

@Module({
  // 代理店資格の取得を検知してウォレット紹介の継承を申請するため
  // (`docs/wallet-user-referral.md` Phase 2)。
  imports: [WalletUserReferralsModule],
  controllers: [AgencyController],
  providers: [AgencyService],
  exports: [AgencyService],
})
export class AgencyModule {}
