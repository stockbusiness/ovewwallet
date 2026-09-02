import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  ServiceUnavailableException,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  CommonEventBodySchema,
  POINT_AWARD_WALLET_DELIVERY_EVENT_TYPE,
  type CommonEventBody,
} from "@ove/shared-types";
import {
  AgencyApiKeyGuard,
  type AuthenticatedPartnerRequest,
} from "../common/agency-api-key.guard";
import { ExternalApiExceptionFilter } from "../common/external-api-exception.filter";
import { isFeatureEnabled } from "../common/feature-flags";
import type { RequestWithId } from "../common/request-id.middleware";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { InboundEventsService } from "./inbound-events.service";

/**
 * 代理店システム(sengoku-ai.com)からのORI付与イベント受信口
 * (`docs/integration/AGENCY_POINT_AWARD.md`)。
 *
 * 既存の共通イベントInbox (`POST /api/integrations/events`) と同じ
 * `InboundEventsService` を通すため、冪等性・再送・dead-letterの扱いは共通である。
 * 別エンドポイントに分けている理由は認証方式が違うことで、こちらは連携先が
 * HMAC署名に対応していないため、既存の代理店連携API
 * (`POST /api/integrations/agencies`) と同じ単純なAPIキー照合を使う。
 * HMAC署名に対応できるようになったら `/api/integrations/events` へ寄せられる
 * (どちらの経路でも、台帳側の `idempotency_key` が二重付与を防ぐ)。
 */
@ApiTags("agency-integration")
@Controller("api/integrations/agencies/point-awards")
@UseFilters(ExternalApiExceptionFilter)
export class AgencyPointAwardController {
  constructor(private readonly inboundEvents: InboundEventsService) {}

  @Post()
  @UseGuards(AgencyApiKeyGuard)
  async receive(
    @Body(new ZodValidationPipe(CommonEventBodySchema)) body: CommonEventBody,
    @Req() req: AuthenticatedPartnerRequest & Partial<RequestWithId>,
    @Headers("idempotency-key") idempotencyKeyHeader: string | undefined,
  ) {
    // Flagは`inbound_events`へ行を作る前に見る。行を作ってしまうと、あとでONにしても
    // 同じevent_idが「処理済み」として二度と再処理されなくなるため
    // (common-events.controller.tsのentitlement系と同じ理由)。
    if (!isFeatureEnabled("ENABLE_AGENCY_POINT_AWARD_INBOX")) {
      throw new ServiceUnavailableException(
        "agency point award inbox is not enabled yet",
      );
    }

    if (body.event_type !== POINT_AWARD_WALLET_DELIVERY_EVENT_TYPE) {
      throw new BadRequestException(
        `this endpoint only accepts event_type "${POINT_AWARD_WALLET_DELIVERY_EVENT_TYPE}"`,
      );
    }

    // 連携先はIdempotency-Keyを送らない場合があるため必須にはしないが、
    // 送ってきた値がbodyのevent_idと食い違う場合は、どちらを冪等キーとして
    // 扱うべきか決められないので受け付けない。
    if (idempotencyKeyHeader && idempotencyKeyHeader !== body.event_id) {
      throw new BadRequestException(
        "Idempotency-Key header does not match body.event_id",
      );
    }

    // 本文が自己申告する source_system_key ではなく、APIキーから確定した送信元を使う
    // (共通イベントInboxと同じ方針。他システムを騙る本文を信用しない)。
    const authenticatedSourceSystemKey = req.serviceIntegration.serviceCode;

    const { cached, result } = await this.inboundEvents.receive(
      body,
      authenticatedSourceSystemKey,
      req.requestId,
    );

    const handled = (result ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      event_id: body.event_id,
      wallet_event_id: handled["wallet_event_id"] ?? null,
      status: handled["status"] ?? "credited",
      // 再送で台帳に触れていないことを送信側から見分けられるようにする
      // (代理店システム側の配信状態を delivered に進めてよい点は初回と同じ)。
      cached,
    };
  }
}
