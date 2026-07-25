import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminWalletReferralsService } from "./admin-wallet-referrals.service";
import { AdminAuthGuard } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

@ApiTags("admin-referrals")
@Controller("api/v1/admin")
export class AdminReferralsController {
  constructor(private readonly walletReferrals: AdminWalletReferralsService) {}

  /**
   * 代理店紹介トークン受け入れの確認画面 (実装指示書 v1.0 14章)。Phase 1のため
   * 確認のみで、管理者による手動確定・取消 (14.3章) はPhase 3で追加する。
   */
  @Get("wallet-referrals")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async listWalletReferrals(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.walletReferrals.list({ status, limit: limit ? Number(limit) : undefined });
  }

  @Get("wallet-referrals/:id")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async walletReferralDetail(@Param("id") id: string): Promise<unknown> {
    return this.walletReferrals.detail(id);
  }
}
