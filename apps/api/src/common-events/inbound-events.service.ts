import { ConflictException, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { generateId, Prisma, type InboundEvent, type PrismaClient } from "@ove/database";
import { sha256Hex } from "@ove/auth";
import type { CommonEventBody } from "@ove/shared-types";
import { PRISMA } from "../common/prisma.module";
import { CommonEventHandlersService } from "./common-event-handlers.service";

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60; // 6時間 (既存のIntegrationOutboxと同じ上限)

export class InboundEventHashMismatchError extends ConflictException {
  constructor(eventId: string) {
    super(`event_id "${eventId}" was already processed with a different request body`);
  }
}

export class InboundEventBusyError extends ConflictException {
  constructor(eventId: string) {
    super(`event_id "${eventId}" is currently being processed by another request`);
  }
}

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 6.4章のInbox冪等性を実装する。
 * `IntegrationOutbox` (9章、送信専用) と対になる受信側の仕組み。
 *
 * - 同一`event_id`かつ同一本文ハッシュ: 前回の処理結果をそのまま返す (再実行しない)。
 * - 同一`event_id`で本文ハッシュが異なる: 処理せず409。
 * - 未処理(PENDING)またはハンドラ失敗(FAILED)の再送: 再実行を試みる
 *   (`MAX_ATTEMPTS`到達でDEADへ遷移し、以後は自動再実行しない)。
 */
@Injectable()
export class InboundEventsService {
  private readonly logger = new Logger(InboundEventsService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly handlers: CommonEventHandlersService,
  ) {}

  async receive(body: CommonEventBody, sourceSystemKeyFromAuth: string): Promise<{ cached: boolean; result: unknown }> {
    const payloadHash = sha256Hex(JSON.stringify(body));

    const existing = await this.db.inboundEvent.findUnique({ where: { eventId: body.event_id } });
    if (existing && existing.payloadHash !== payloadHash) {
      throw new InboundEventHashMismatchError(body.event_id);
    }
    if (existing?.status === "SUCCEEDED") {
      return { cached: true, result: existing.resultPayload };
    }

    const row = existing ?? (await this.createPendingRow(body, sourceSystemKeyFromAuth, payloadHash));
    return this.process(row, body);
  }

  private async createPendingRow(
    body: CommonEventBody,
    sourceSystemKeyFromAuth: string,
    payloadHash: string,
  ): Promise<InboundEvent> {
    try {
      return await this.db.inboundEvent.create({
        data: {
          id: generateId(),
          eventId: body.event_id,
          eventType: body.event_type,
          eventVersion: body.event_version,
          sourceSystemKey: sourceSystemKeyFromAuth,
          payload: body as unknown as Prisma.InputJsonValue,
          payloadHash,
          correlationId: body.correlation_id ?? undefined,
          status: "PENDING",
        },
      });
    } catch (error) {
      // 同時に同じevent_idが2リクエストで到着した場合の一意制約違反。競合に負けた側は
      // 相手が作成した行を読み直して処理を続ける (取りこぼしを起こさない)。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const race = await this.db.inboundEvent.findUniqueOrThrow({ where: { eventId: body.event_id } });
        if (race.payloadHash !== payloadHash) throw new InboundEventHashMismatchError(body.event_id);
        return race;
      }
      throw error;
    }
  }

  private async process(row: InboundEvent, body: CommonEventBody): Promise<{ cached: boolean; result: unknown }> {
    const claimed = await this.db.inboundEvent.updateMany({
      where: { id: row.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "PROCESSING", attemptCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const fresh = await this.db.inboundEvent.findUniqueOrThrow({ where: { id: row.id } });
      if (fresh.status === "SUCCEEDED") return { cached: true, result: fresh.resultPayload };
      if (fresh.status === "DEAD") {
        throw new ServiceUnavailableException(
          `event_id "${body.event_id}" has exceeded the maximum retry attempts (dead-letter)`,
        );
      }
      throw new InboundEventBusyError(body.event_id);
    }

    try {
      const result = await this.handlers.dispatch(body.event_type, body);
      const updated = await this.db.inboundEvent.update({
        where: { id: row.id },
        data: {
          status: "SUCCEEDED",
          resultPayload: (result ?? {}) as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
      return { cached: false, result: updated.resultPayload };
    } catch (error) {
      await this.recordFailure(row.id, error);
      throw error;
    }
  }

  private async recordFailure(id: string, error: unknown): Promise<void> {
    const fresh = await this.db.inboundEvent.findUniqueOrThrow({ where: { id } });
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = fresh.attemptCount >= MAX_ATTEMPTS;
    const backoffSeconds = Math.min(BASE_BACKOFF_SECONDS * 2 ** (fresh.attemptCount - 1), MAX_BACKOFF_SECONDS);
    this.logger.warn(`inbound event ${id} (event_id=${fresh.eventId}) failed (attempt ${fresh.attemptCount}): ${message}`);

    await this.db.inboundEvent.update({
      where: { id },
      data: {
        status: exhausted ? "DEAD" : "FAILED",
        lastErrorMessage: message.slice(0, 1000),
        nextRetryAt: exhausted ? null : new Date(Date.now() + backoffSeconds * 1000),
      },
    });
  }

  async list(params: { status?: string; eventType?: string; limit?: number }): Promise<InboundEvent[]> {
    return this.db.inboundEvent.findMany({
      where: {
        status: params.status ? (params.status as never) : undefined,
        eventType: params.eventType,
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 100, 500),
    });
  }
}
