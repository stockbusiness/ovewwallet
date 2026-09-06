import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { SupportInquiryStatus } from "@ove/database";
import { z } from "zod";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  SupportInquiryReplySchema,
  SupportInquiryStatusSchema,
} from "../support/dto/support-inquiry.dto";
import { AdminSupportInquiriesService } from "./admin-support-inquiries.service";

/**
 * 利用者からの問い合わせ (docs/support-inquiries.md)。
 *
 * 問い合わせ本文には利用者の個人的な事情が書かれうるので、閲覧できるロールを
 * お知らせの管理と同じ範囲に絞る。
 */
@ApiTags("admin-support-inquiries")
@Controller("api/v1/admin/support-inquiries")
export class AdminSupportInquiriesController {
  constructor(private readonly inquiries: AdminSupportInquiriesService) {}

  @Get()
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "AUDITOR")
  async list(@Query("status") status?: string) {
    return this.inquiries.list(status ? (status as SupportInquiryStatus) : undefined);
  }

  @Get(":id")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "AUDITOR")
  async get(@Param("id") id: string) {
    return this.inquiries.get(id);
  }

  @Post(":id/status")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async updateStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SupportInquiryStatusSchema))
    body: z.infer<typeof SupportInquiryStatusSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.inquiries.updateStatus(id, body, req.admin.id);
  }

  /** 返信する。本人宛のお知らせが1件作られる。 */
  @Post(":id/reply")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async reply(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SupportInquiryReplySchema))
    body: z.infer<typeof SupportInquiryReplySchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.inquiries.reply(id, body, req.admin.id);
  }
}
