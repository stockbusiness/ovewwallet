import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { AdminWalletReferralsService } from "./admin-wallet-referrals.service";
import { WalletReferralManualAttachSchema } from "./dto/admin-integrations.dto";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";

@ApiTags("admin-referrals")
@Controller("api/v1/admin")
export class AdminReferralsController {
  constructor(private readonly walletReferrals: AdminWalletReferralsService) {}

  /** 代理店紹介トークン受け入れの確認画面 (実装指示書 v1.0 14章)。 */
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

  /**
   * 紹介URLは踏まれたのに登録へ紐付かなかった紹介を、後からORIアカウントへ紐付ける
   * (実装指示書14.3章)。紹介の紐付けは新規アカウント作成時にしか起きないため、
   * 先にウォレットへ登録してしまった人を個別に救済する経路になる。
   *
   * 代理店の成果の宛先を決める操作なので、閲覧専用のAUDITORには開けない。
   */
  @Post("wallet-referrals/:id/attach")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async attachWalletReferral(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(WalletReferralManualAttachSchema))
    body: z.infer<typeof WalletReferralManualAttachSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ): Promise<unknown> {
    return this.walletReferrals.attachManually({
      id,
      account: body.account,
      adminId: req.admin.id,
      reason: body.reason,
    });
  }
}
