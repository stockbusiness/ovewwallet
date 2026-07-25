import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { AdminAuthGuard } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

/**
 * リファクタリング指示書 Phase 1: 旧`AdminController`はここまで縮小した残余
 * (業務ドメイン横断の集計エンドポイントのみ)。個別ドメインのルートは
 * `admin-auth.controller.ts` 等の9コントローラへ分割済み (100行未満)。
 */
@ApiTags("admin")
@Controller("api/v1/admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** PC向け管理ダッシュボード (指示書13章) 用の集計値・過去30日推移。 */
  @Get("dashboard-stats")
  @UseGuards(AdminAuthGuard)
  async dashboardStats() {
    return this.admin.getDashboardStats();
  }

  /** ダッシュボード向け、会員ランク (docs/wallet-rank.md) の人数分布。 */
  @Get("dashboard-stats/rank-distribution")
  @UseGuards(AdminAuthGuard)
  async rankDistribution() {
    return this.admin.getRankDistribution();
  }

  @Get("reconciliation")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "AUDITOR", "OVE_OPERATOR")
  async reconciliation() {
    return this.admin.reconcile();
  }
}
