import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { AgencyModule } from "../agency/agency.module";
import { ReferralsModule } from "../referrals/referrals.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { EmailDomainPolicyService } from "./email-domain-policy.service";

@Module({
  imports: [AccountsModule, AgencyModule, ReferralsModule],
  controllers: [AuthController],
  // EmailDomainPolicyService は管理画面 (AdminModule) からも設定変更後の
  // キャッシュ破棄に使うため export する。
  providers: [AuthService, EmailDomainPolicyService],
  exports: [EmailDomainPolicyService],
})
export class AuthModule {}
