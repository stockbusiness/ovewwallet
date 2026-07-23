import { Inject, Injectable } from "@nestjs/common";
import type { InboundEvent, Prisma, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CreatePendingInboundEventParams {
  id: string;
  eventId: string;
  eventType: string;
  eventVersion: string;
  sourceSystemKey: string;
  payload: Prisma.InputJsonValue;
  payloadHash: string;
  correlationId?: string;
}

export interface InboundEventListParams {
  status?: string;
  eventType?: string;
  limit?: number;
}

/**
 * リファクタリング指示書 Phase 8「DBアクセス境界」。`InboundEventsService`が
 * 直接行っていた`InboundEvent`へのPrismaアクセスを集約する。冪等性判定・
 * リトライ/バックオフ等の業務ロジックは引き続き`InboundEventsService`が持ち、
 * このRepositoryは素朴なデータアクセスのみを担う。
 */
@Injectable()
export class InboundEventRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findByEventId(eventId: string, client: Db = this.db): Promise<InboundEvent | null> {
    return client.inboundEvent.findUnique({ where: { eventId } });
  }

  async findByEventIdOrThrow(eventId: string, client: Db = this.db): Promise<InboundEvent> {
    return client.inboundEvent.findUniqueOrThrow({ where: { eventId } });
  }

  async findByIdOrThrow(id: string, client: Db = this.db): Promise<InboundEvent> {
    return client.inboundEvent.findUniqueOrThrow({ where: { id } });
  }

  async createPending(params: CreatePendingInboundEventParams, client: Db = this.db): Promise<InboundEvent> {
    return client.inboundEvent.create({
      data: {
        id: params.id,
        eventId: params.eventId,
        eventType: params.eventType,
        eventVersion: params.eventVersion,
        sourceSystemKey: params.sourceSystemKey,
        payload: params.payload,
        payloadHash: params.payloadHash,
        correlationId: params.correlationId,
        status: "PENDING",
      },
    });
  }

  /** PENDING/FAILEDの行だけを条件付きでPROCESSINGへ更新する (複数ワーカーの二重処理防止)。 */
  async claimForProcessing(id: string, client: Db = this.db): Promise<boolean> {
    const result = await client.inboundEvent.updateMany({
      where: { id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "PROCESSING", attemptCount: { increment: 1 } },
    });
    return result.count === 1;
  }

  async markSucceeded(id: string, resultPayload: Prisma.InputJsonValue, client: Db = this.db): Promise<InboundEvent> {
    return client.inboundEvent.update({
      where: { id },
      data: { status: "SUCCEEDED", resultPayload, processedAt: new Date() },
    });
  }

  async markFailed(
    id: string,
    params: { status: "FAILED" | "DEAD"; lastErrorMessage: string; nextRetryAt: Date | null },
    client: Db = this.db,
  ): Promise<InboundEvent> {
    return client.inboundEvent.update({
      where: { id },
      data: { status: params.status, lastErrorMessage: params.lastErrorMessage, nextRetryAt: params.nextRetryAt },
    });
  }

  async list(params: InboundEventListParams, client: Db = this.db): Promise<InboundEvent[]> {
    return client.inboundEvent.findMany({
      where: {
        status: params.status ? (params.status as never) : undefined,
        eventType: params.eventType,
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 100, 500),
    });
  }
}
