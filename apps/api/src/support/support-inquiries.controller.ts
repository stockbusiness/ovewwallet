import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { SessionAuthGuard, type AuthenticatedUserRequest } from "../common/session-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SupportInquiryCreateSchema } from "./dto/support-inquiry.dto";
import { SupportInquiriesService } from "./support-inquiries.service";

/** 同じ本文の二重登録とみなす時間。送信ボタンの連打を想定している。 */
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * 利用者からの問い合わせ (docs/support-inquiries.md)。
 *
 * 本人のセッションでのみ受け付ける。誰のアカウントの話かを、利用者の自己申告では
 * なくセッションから確定させるため。
 */
@ApiTags("support")
@Controller("api/v1/me/support-inquiries")
export class SupportInquiriesController {
  constructor(private readonly inquiries: SupportInquiriesService) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  async listMine(@Req() req: AuthenticatedUserRequest) {
    return this.inquiries.listMine(req.account.id);
  }

  /** 送信。困っている人を止めない範囲で、いたずらに何百件も入らない程度に絞る。 */
  @Post()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @UseGuards(SessionAuthGuard)
  async create(
    @Body(new ZodValidationPipe(SupportInquiryCreateSchema))
    body: z.infer<typeof SupportInquiryCreateSchema>,
    @Req() req: AuthenticatedUserRequest,
  ) {
    // 連打で同じ内容が並ぶと、運用側がどれを見ればよいか分からなくなる。
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    if (await this.inquiries.hasRecentDuplicate(req.account.id, body.message, since)) {
      throw new BadRequestException("same inquiry was submitted recently");
    }
    return this.inquiries.create({
      oveAccountId: req.account.id,
      category: body.category,
      message: body.message,
    });
  }
}
