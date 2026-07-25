import { Injectable, Logger } from "@nestjs/common";
import { generateId, type Prisma, type PrismaClient } from "@ove/database";
import { OutboxRepository } from "./outbox.repository";

export interface OutboxEnqueueParams {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  destinationService: string;
  payload: unknown;
  /** 同じイベントの二重登録防止に使う。呼び出しのたびに新規生成される値ではなく、
   * イベント内容から導出される安定した値を渡すこと。 */
  idempotencyKey: string;
}

export interface OutboxEvent {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
}

export interface OutboxDestinationHandler {
  send(event: OutboxEvent): Promise<void>;
}

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60; // 6時間

/**
 * Transactional Outbox (開発ガイドライン10章)。宛先ごとの送信実装
 * (`OutboxDestinationHandler`) は `registerDestination` で差し替え可能にしておき、
 * 代理店システム等の実際の連携先が決まった時点で本実装へ差し替える
 * (LINE/戦国パスポートSSOをモック実装から差し替え可能にしているのと同じ設計)。
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly destinations = new Map<string, OutboxDestinationHandler>();

  constructor(private readonly repository: OutboxRepository) {}

  registerDestination(destinationService: string, handler: OutboxDestinationHandler): void {
    this.destinations.set(destinationService, handler);
  }

  /**
   * 業務トランザクション内から呼び出すことを想定 (例: `db.$transaction(async (tx) => {...;
   * await outbox.enqueue(tx, {...}); })`)。これにより、業務データの確定とイベントの記録が
   * 同一トランザクションで確定し、イベント登録漏れが起きない。
   */
  async enqueue(tx: Prisma.TransactionClient | PrismaClient, params: OutboxEnqueueParams) {
    return this.repository.upsertByIdempotencyKey(tx, {
      id: generateId(),
      eventType: params.eventType,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      destinationService: params.destinationService,
      payload: params.payload as Prisma.InputJsonValue,
      idempotencyKey: params.idempotencyKey,
    });
  }

  /**
   * 送信期日 (`available_at`) が来ているPENDINGイベントを処理する。1件ずつ
   * PENDING→PROCESSINGへの条件付き更新で「claim」してから処理するため、複数ワーカーが
   * 同時に動いても同じイベントを二重送信しない。
   */
  async processPendingEvents(limit = 20): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    const due = await this.repository.findDuePending(limit);

    for (const event of due) {
      const claimed = await this.repository.claim(event.id);
      if (!claimed) continue;

      const handler = this.destinations.get(event.destinationService);
      try {
        if (!handler) {
          throw new Error(`no destination handler registered for "${event.destinationService}"`);
        }
        await handler.send(event);
        await this.repository.markSent(event.id);
        processed++;
      } catch (err) {
        await this.recordFailure(event.id, event.attemptCount + 1, err);
        failed++;
      }
    }

    return { processed, failed };
  }

  private async recordFailure(id: string, attemptCount: number, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const exhausted = attemptCount >= MAX_ATTEMPTS;
    const backoffSeconds = Math.min(BASE_BACKOFF_SECONDS * 2 ** (attemptCount - 1), MAX_BACKOFF_SECONDS);
    this.logger.warn(`outbox event ${id} failed (attempt ${attemptCount}): ${message}`);

    await this.repository.recordFailure(id, {
      status: exhausted ? "FAILED" : "PENDING",
      attemptCount,
      lastErrorMessage: message.slice(0, 1000),
      availableAt: exhausted ? undefined : new Date(Date.now() + backoffSeconds * 1000),
    });
  }

  /** 管理画面からの手動再送 (開発ガイドライン15章)。FAILED/PENDINGいずれからも再送できる。 */
  async manualRetry(id: string): Promise<void> {
    await this.repository.manualRetry(id);
  }

  async list(params: { status?: string; destinationService?: string; limit?: number }): Promise<unknown[]> {
    return this.repository.list(params);
  }
}
