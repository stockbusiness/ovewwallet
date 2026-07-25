import { Inject, Injectable } from "@nestjs/common";
import type { IntegrationOutbox, Prisma, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface EnqueueOutboxRowParams {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  destinationService: string;
  payload: Prisma.InputJsonValue;
  idempotencyKey: string;
}

export interface OutboxListParams {
  status?: string;
  destinationService?: string;
  limit?: number;
}

/**
 * リファクタリング指示書 Phase 8「DBアクセス境界」。`OutboxService`が直接
 * 行っていた`IntegrationOutbox`へのPrismaアクセスを集約する。宛先ハンドラ登録・
 * 指数バックオフ計算等の業務ロジックは引き続き`OutboxService`が持つ。
 */
@Injectable()
export class OutboxRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /**
   * 業務トランザクション内から呼び出すことを想定 (`OutboxService.enqueue`と同じ契約)。
   * `client`を明示的に渡すことで、業務データの確定とイベントの記録を同一
   * トランザクションで確定できる。
   */
  async upsertByIdempotencyKey(client: Db, params: EnqueueOutboxRowParams): Promise<IntegrationOutbox> {
    return client.integrationOutbox.upsert({
      where: { idempotencyKey: params.idempotencyKey },
      update: {},
      create: {
        id: params.id,
        eventType: params.eventType,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        destinationService: params.destinationService,
        payload: params.payload,
        idempotencyKey: params.idempotencyKey,
      },
    });
  }

  async findDuePending(limit: number, client: Db = this.db): Promise<IntegrationOutbox[]> {
    return client.integrationOutbox.findMany({
      where: { status: "PENDING", availableAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  /** PENDINGの行だけを条件付きでPROCESSINGへ更新する (複数ワーカーの二重送信防止)。 */
  async claim(id: string, client: Db = this.db): Promise<boolean> {
    const result = await client.integrationOutbox.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "PROCESSING", lockedAt: new Date() },
    });
    return result.count === 1;
  }

  async markSent(id: string, client: Db = this.db): Promise<void> {
    await client.integrationOutbox.update({
      where: { id },
      data: { status: "SENT", processedAt: new Date(), lockedAt: null },
    });
  }

  async recordFailure(
    id: string,
    params: { status: "PENDING" | "FAILED"; attemptCount: number; lastErrorMessage: string; availableAt: Date | undefined },
    client: Db = this.db,
  ): Promise<void> {
    await client.integrationOutbox.update({
      where: { id },
      data: {
        status: params.status,
        attemptCount: params.attemptCount,
        lockedAt: null,
        lastErrorMessage: params.lastErrorMessage,
        availableAt: params.availableAt,
      },
    });
  }

  async manualRetry(id: string, client: Db = this.db): Promise<void> {
    await client.integrationOutbox.update({
      where: { id },
      data: { status: "PENDING", availableAt: new Date(), lockedAt: null, attemptCount: 0 },
    });
  }

  async list(params: OutboxListParams, client: Db = this.db): Promise<IntegrationOutbox[]> {
    return client.integrationOutbox.findMany({
      where: {
        status: params.status ? (params.status as never) : undefined,
        destinationService: params.destinationService,
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 100, 500),
    });
  }
}
