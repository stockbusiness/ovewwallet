import { Body, Controller, Post, ServiceUnavailableException, UseFilters, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommonEventBodySchema, type CommonEventBody } from "@ove/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ExternalApiExceptionFilter } from "../common/external-api-exception.filter";
import { isFeatureEnabled } from "../common/feature-flags";
import { CommonEventAuthGuard } from "./common-event-auth.guard";
import { InboundEventsService } from "./inbound-events.service";

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 6章。代理店システム等から共通イベントを
 * 受信するInboxエンドポイント。`ENABLE_COMMON_EVENT_INBOX` (既定false) で
 * 段階的に有効化する。
 */
@ApiTags("common-events")
@Controller("api/integrations/events")
@UseFilters(ExternalApiExceptionFilter)
export class CommonEventsController {
  constructor(private readonly inboundEvents: InboundEventsService) {}

  @Post()
  @UseGuards(CommonEventAuthGuard)
  async receive(@Body(new ZodValidationPipe(CommonEventBodySchema)) body: CommonEventBody) {
    if (!isFeatureEnabled("ENABLE_COMMON_EVENT_INBOX")) {
      throw new ServiceUnavailableException("common event inbox is not enabled yet");
    }

    const { cached, result } = await this.inboundEvents.receive(body, body.source_system_key);
    return { ok: true, event_id: body.event_id, cached, result };
  }
}
