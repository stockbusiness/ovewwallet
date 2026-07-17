import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AccountsModule } from "../accounts/accounts.module";
import { AgencyModule } from "../agency/agency.module";
import { ReferralsModule } from "../referrals/referrals.module";

@Module({
  imports: [AccountsModule, AgencyModule, ReferralsModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
