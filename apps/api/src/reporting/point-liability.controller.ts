import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminAuthGuard } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { PointLiabilityService } from "./point-liability.service";
import { rollForwardToCsv } from "./point-liability.csv";

/** 増減表で遡れる月数の上限と既定値。 */
const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 60;

function parseMonths(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MONTHS;
  return Math.min(parsed, MAX_MONTHS);
}

/**
 * ポイント負債レポート (docs/point-liability.md)。
 *
 * 会計・監査が使う数字のため、閲覧は `SUPER_ADMIN` / `AUDITOR` に限る
 * (全社の未使用残高は、個々の利用者の残高より機微な経営情報のため)。
 */
@ApiTags("admin-reporting")
@Controller("api/v1/admin/reports/point-liability")
@UseGuards(AdminAuthGuard, RolesGuard)
@Roles("SUPER_ADMIN", "AUDITOR")
export class PointLiabilityController {
  constructor(private readonly liability: PointLiabilityService) {}

  /** 現時点の負債残高と失効見込み。 */
  @Get()
  async current() {
    return this.liability.getCurrentLiability();
  }

  /** 月次増減表 (期首 + 発行 − 利用 − 失効 ± 取消 = 期末)。 */
  @Get("roll-forward")
  async rollForward(@Query("months") months?: string) {
    return this.liability.getRollForward(parseMonths(months));
  }

  /** 月次増減表のCSV。会計へそのまま渡せる形にする。 */
  @Get("roll-forward/export")
  async exportRollForward(@Query("months") months: string | undefined, @Res() res: Response) {
    const rows = await this.liability.getRollForward(parseMonths(months));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="point-liability.csv"');
    res.send(rollForwardToCsv(rows));
  }
}
