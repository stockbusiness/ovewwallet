import { Module } from "@nestjs/common";
import { SupportInquiriesController } from "./support-inquiries.controller";
import { SupportInquiriesService } from "./support-inquiries.service";

@Module({
  controllers: [SupportInquiriesController],
  providers: [SupportInquiriesService],
  // 管理画面 (AdminModule) から一覧・返信に使う。
  exports: [SupportInquiriesService],
})
export class SupportModule {}
