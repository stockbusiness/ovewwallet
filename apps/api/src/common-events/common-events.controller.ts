import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommonEventBodySchema, COMMON_EVENT_SUPPORTED_VERSIONS, type CommonEventBody } from "@ove/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ExternalApiExceptionFilter } from "../common/external-api-exception.filter";
import { isFeatureEnabled } from "../common/feature-flags";
import { CommonEventAuthGuard, type AuthenticatedCommonEventRequest } from "./common-event-auth.guard";
import { matchesAllowedEventType } from "./common-event-signing-keys.service";
import { InboundEventsService } from "./inbound-events.service";

const SUPPORTED_EVENT_VERSIONS = new Set<string>(COMMON_EVENT_SUPPORTED_VERSIONS);

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 6章 / v1.1 DRAFT。代理店システム等から共通イベントを
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
  async receive(
    @Body(new ZodValidationPipe(CommonEventBodySchema)) body: CommonEventBody,
    @Req() req: AuthenticatedCommonEventRequest,
    @Headers("idempotency-key") idempotencyKeyHeader: string | undefined,
    @Headers("x-event-version") eventVersionHeader: string | undefined,
  ) {
    if (!isFeatureEnabled("ENABLE_COMMON_EVENT_INBOX")) {
      throw new ServiceUnavailableException("common event inbox is not enabled yet");
    }

    // 共通契約v1.1 DRAFT 9章: 「HeaderのIdempotency-Keyとbodyのevent_idは一致必須」。
    if (!idempotencyKeyHeader) {
      throw new BadRequestException("missing Idempotency-Key header");
    }
    if (idempotencyKeyHeader !== body.event_id) {
      throw new BadRequestException("Idempotency-Key header does not match body.event_id");
    }

    // 共通契約v1.1 DRAFT 8章: 「Headerとbodyが両方ある場合は一致必須」「サポート外versionは
    // 422 unsupported_event_version」。X-Event-Versionヘッダーは契約上任意ヘッダーのため
    // 未送信の場合はbody.event_versionのみで判定する。
    if (eventVersionHeader && eventVersionHeader !== body.event_version) {
      throw new UnprocessableEntityException(
        `X-Event-Version header ("${eventVersionHeader}") does not match body.event_version ("${body.event_version}")`,
      );
    }
    if (!SUPPORTED_EVENT_VERSIONS.has(body.event_version)) {
      throw new UnprocessableEntityException(`unsupported event_version "${body.event_version}"`);
    }

    // 次期改修指示書P0-1: 認証済みの送信元 (署名鍵から解決、req.commonEventSourceSystemKey)
    // を真実源とし、本文が自己申告するsource_system_keyとは必ず一致させる。他システムの
    // 鍵で別システムを騙るなりすましを防ぐ。
    if (body.source_system_key !== req.commonEventSourceSystemKey) {
      throw new ForbiddenException(
        `body.source_system_key ("${body.source_system_key}") does not match the authenticated key's source_system_key ("${req.commonEventSourceSystemKey}")`,
      );
    }

    // 次期改修指示書P0-3: 鍵ごとに送信を許可するevent_typeを制限する。
    if (!matchesAllowedEventType(req.commonEventAllowedEventTypes, body.event_type)) {
      throw new ForbiddenException(
        `key_id is not permitted to send event_type "${body.event_type}"`,
      );
    }

    const { cached, result } = await this.inboundEvents.receive(body, req.commonEventSourceSystemKey);
    return { ok: true, event_id: body.event_id, cached, result };
  }
}
