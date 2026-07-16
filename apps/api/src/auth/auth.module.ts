import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AccountsModule } from "../accounts/accounts.module";
import { AgencyModule } from "../agency/agency.module";

@Module({
  imports: [AccountsModule, AgencyModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
