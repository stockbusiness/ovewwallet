import { Injectable, Logger } from "@nestjs/common";
import { generateId, type Prisma, type PrismaClient } from "@ove/database";
import { captureMessage } from "../common/sentry";
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
  /** `${destinationService}\u0000${eventType}` をキーにしたevent_type単位の送信実装。 */
  private readonly eventHandlers = new Map<string, OutboxDestinationHandler>();

  constructor(private readonly repository: OutboxRepository) {}

  /**
   * 宛先サービス全体の既定の送信実装。
   *
   * 同じ宛先に2回登録すると、後から登録した側が黙って前の実装を置き換えて
   * しまい、片方のイベントが送られなくなる (しかもモジュールの初期化順に依存
   * するため再現しづらい)。同じ宛先で複数のevent_typeを扱う場合は
   * `registerEventHandler`を使う。
   */
  registerDestination(destinationService: string, handler: OutboxDestinationHandler): void {
    const existing = this.destinations.get(destinationService);
    if (existing && existing !== handler) {
      throw new Error(
        `a default outbox handler is already registered for "${destinationService}"; ` +
          "use registerEventHandler() to add an event_type specific handler",
      );
    }
    this.destinations.set(destinationService, handler);
  }

  /**
   * 同じ宛先サービスのうち、特定のevent_typeだけを扱う送信実装。
   * 既定の実装 (`registerDestination`) より優先される。
   */
  registerEventHandler(
    destinationService: string,
    eventType: string,
    handler: OutboxDestinationHandler,
  ): void {
    this.eventHandlers.set(eventHandlerKey(destinationService, eventType), handler);
  }

  /** event_type専用の実装があればそれを、無ければ宛先の既定実装を返す。 */
  private resolveHandler(destinationService: string, eventType: string): OutboxDestinationHandler | undefined {
    return (
      this.eventHandlers.get(eventHandlerKey(destinationService, eventType)) ??
      this.destinations.get(destinationService)
    );
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

      const handler = this.resolveHandler(event.destinationService, event.eventType);
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

    // 不足機能実装指示書PR-W04 §8.4「Outbox FAILED」。Dead Letter (再送上限到達) は
    // 人手による調査・手動再送が必要な状態のため、Sentryへ通知する (SENTRY_DSN未設定時は
    // no-op)。再送中の一時的な失敗 (exhausted=false) はログのみで十分なため送らない。
    if (exhausted) {
      captureMessage(`Outbox event ${id} reached FAILED after ${attemptCount} attempts: ${message}`, "error");
    }

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

function eventHandlerKey(destinationService: string, eventType: string): string {
  return `${destinationService}\u0000${eventType}`;
}
