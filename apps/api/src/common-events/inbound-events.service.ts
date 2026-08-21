import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { sha256Hex } from "@ove/auth";
import { generateId, Prisma, type InboundEvent } from "@ove/database";
import type { CommonEventBody } from "@ove/shared-types";
import { CommonEventHandlersService } from "./common-event-handlers.service";
import { InboundEventRepository } from "./inbound-event.repository";

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60; // 6時間 (既存のIntegrationOutboxと同じ上限)

export class InboundEventHashMismatchError extends ConflictException {
  constructor(eventId: string) {
    super(
      `event_id "${eventId}" was already processed with a different request body`,
    );
  }
}

export class InboundEventBusyError extends ConflictException {
  constructor(eventId: string) {
    super(
      `event_id "${eventId}" is currently being processed by another request`,
    );
  }
}

/**
 * compatibility guard (PR-W3-a-2レビュー指摘c、削除しない)。`InboundEvent.eventId`が
 * 単独UNIQUE制約だった期間 (PR-W3-a-1〜a-2移行期) の名残り。異なるsource_system_keyが
 * 同一event_id値を送った場合にDB側でP2002が起こり得た。本来は別イベントとして
 * 扱われるべきだが旧制約下では区別できなかったため、500(未捕捉例外)ではなく
 * 409として返していた。
 *
 * PR-W3-a-2で`source_system_key + event_id`の複合UNIQUEへ切り替えた後は、異なる
 * source_system_key同士は衝突しなくなるため、このエラーの発生経路は通常到達しない。
 * それでも削除しない理由:
 *   - ローリングデプロイ中、新旧コンテナが混在する短い期間の互換性を保つため
 *   - 万一DB側の制約が単独UNIQUEへロールバックされた場合の防御になるため
 * 本番でこの経路が実際に到達しなくなったことを確認した後、別PRで削除を検討する
 * (このPRのスコープではない)。
 */
export class InboundEventCrossSourceConflictError extends ConflictException {
  constructor(eventId: string) {
    super(
      `event_id "${eventId}" is already in use by a different source_system_key`,
    );
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
    private readonly repository: InboundEventRepository,
    private readonly handlers: CommonEventHandlersService,
  ) {}

  async receive(
    body: CommonEventBody,
    sourceSystemKeyFromAuth: string,
    requestId?: string,
  ): Promise<{ cached: boolean; result: unknown }> {
    const payloadHash = sha256Hex(JSON.stringify(body));

    const existing = await this.repository.findBySourceSystemKeyAndEventId(
      sourceSystemKeyFromAuth,
      body.event_id,
    );
    if (existing && existing.payloadHash !== payloadHash) {
      throw new InboundEventHashMismatchError(body.event_id);
    }
    if (existing?.status === "SUCCEEDED") {
      return { cached: true, result: existing.resultPayload };
    }

    const row =
      existing ??
      (await this.createPendingRow(body, sourceSystemKeyFromAuth, payloadHash));
    return this.process(row, body, requestId);
  }

  private async createPendingRow(
    body: CommonEventBody,
    sourceSystemKeyFromAuth: string,
    payloadHash: string,
  ): Promise<InboundEvent> {
    try {
      return await this.repository.createPending({
        id: generateId(),
        eventId: body.event_id,
        eventType: body.event_type,
        eventVersion: body.event_version,
        sourceSystemKey: sourceSystemKeyFromAuth,
        payload: body as unknown as Prisma.InputJsonValue,
        payloadHash,
        correlationId: body.correlation_id ?? undefined,
      });
    } catch (error) {
      // 同時に同じevent_idが2リクエストで到着した場合の一意制約違反。競合に負けた側は
      // 相手が作成した行を読み直して処理を続ける (取りこぼしを起こさない)。
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const race = await this.repository.findBySourceSystemKeyAndEventId(
          sourceSystemKeyFromAuth,
          body.event_id,
        );
        if (!race)
          throw new InboundEventCrossSourceConflictError(body.event_id);
        if (race.payloadHash !== payloadHash)
          throw new InboundEventHashMismatchError(body.event_id);
        return race;
      }
      throw error;
    }
  }

  private async process(
    row: InboundEvent,
    body: CommonEventBody,
    requestId?: string,
  ): Promise<{ cached: boolean; result: unknown }> {
    const claimed = await this.repository.claimForProcessing(row.id);
    if (!claimed) {
      const fresh = await this.repository.findByIdOrThrow(row.id);
      if (fresh.status === "SUCCEEDED")
        return { cached: true, result: fresh.resultPayload };
      if (fresh.status === "DEAD") {
        throw new ServiceUnavailableException(
          `event_id "${body.event_id}" has exceeded the maximum retry attempts (dead-letter)`,
        );
      }
      throw new InboundEventBusyError(body.event_id);
    }

    try {
      // 次期改修指示書P0-1: ハンドラへは認証済みの送信元 (row.sourceSystemKey、guard/
      // controllerで検証済み) を渡し、本文の自己申告値を再度信用しない。
      const result = await this.handlers.dispatch(
        body.event_type,
        body,
        row.sourceSystemKey,
        requestId,
      );
      const updated = await this.repository.markSucceeded(
        row.id,
        (result ?? {}) as Prisma.InputJsonValue,
      );
      return { cached: false, result: updated.resultPayload };
    } catch (error) {
      await this.recordFailure(row.id, error);
      throw error;
    }
  }

  private async recordFailure(id: string, error: unknown): Promise<void> {
    const fresh = await this.repository.findByIdOrThrow(id);
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = fresh.attemptCount >= MAX_ATTEMPTS;
    const backoffSeconds = Math.min(
      BASE_BACKOFF_SECONDS * 2 ** (fresh.attemptCount - 1),
      MAX_BACKOFF_SECONDS,
    );
    this.logger.warn(
      `inbound event ${id} (event_id=${fresh.eventId}) failed (attempt ${fresh.attemptCount}): ${message}`,
    );

    await this.repository.markFailed(id, {
      status: exhausted ? "DEAD" : "FAILED",
      lastErrorMessage: message.slice(0, 1000),
      nextRetryAt: exhausted
        ? null
        : new Date(Date.now() + backoffSeconds * 1000),
    });
  }

  async list(params: {
    status?: string;
    eventType?: string;
    limit?: number;
  }): Promise<InboundEvent[]> {
    return this.repository.list(params);
  }
}
