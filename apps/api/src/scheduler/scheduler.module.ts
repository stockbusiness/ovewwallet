import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AdminModule } from "../admin/admin.module";
import { ReportingModule } from "../reporting/reporting.module";
import { OutboxModule } from "../outbox/outbox.module";
import { DataRetentionService } from "./data-retention.service";
import { ExpiryNoticeService } from "./expiry-notice.service";
import { SchedulerService } from "./scheduler.service";

/**
 * 運用処理の定期実行 (`SchedulerService`)。
 *
 * 処理そのものは管理画面と同じサービス (`AdminService.reconcile()` /
 * `AdminRewardRulesService.runExpiryBatch()` / `OutboxService.processPendingEvents()`) を
 * 呼び出す。手動実行と自動実行で挙動が分かれないよう、ロジックはここに複製しない。
 */
@Module({
  imports: [ScheduleModule.forRoot(), AdminModule, OutboxModule, ReportingModule],
  providers: [SchedulerService, DataRetentionService, ExpiryNoticeService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
