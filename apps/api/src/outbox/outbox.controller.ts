import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { OutboxService } from "./outbox.service";
import { getAllFeatureFlags } from "../common/feature-flags";
import { AdminAuthGuard } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

/**
 * Transactional Outbox の管理画面向け参照/手動再送API (開発ガイドライン15章
 * 「紹介連携状態一覧・SYNC_PENDING/FAILED/CONFLICTの絞り込み・自動再送回数・手動再送」)。
 * 現時点では代理店システム等の実際の宛先ハンドラは未登録のため、キューは空か
 * `no destination handler registered` エラーのイベントのみが積まれる想定。
 */
@ApiTags("admin-outbox")
@Controller("api/v1/admin/outbox")
export class OutboxController {
  constructor(private readonly outbox: OutboxService) {}

  @Get()
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "AUDITOR", "INTEGRATION_ADMIN")
  async list(@Query("status") status?: string, @Query("destinationService") destinationService?: string) {
    return this.outbox.list({ status, destinationService });
  }

  /** 保留中の再送期日が来ているイベントをまとめて処理する。将来はスケジューラから呼び出す。 */
  @Post("dispatch")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async dispatch() {
    return this.outbox.processPendingEvents();
  }

  @Post(":id/retry")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async retry(@Param("id") id: string) {
    await this.outbox.manualRetry(id);
    return { success: true };
  }
}

/** Feature Flag確認 (開発ガイドライン15章「必須」)。値はすべて環境変数から読み取る (DB管理外)。 */
@ApiTags("admin-feature-flags")
@Controller("api/v1/admin/feature-flags")
export class FeatureFlagsController {
  @Get()
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "AUDITOR", "INTEGRATION_ADMIN")
  async list() {
    return getAllFeatureFlags();
  }
}
