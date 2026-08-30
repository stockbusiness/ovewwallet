import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import {
  API_ACCESS_LOG_RETENTION_DAYS,
  OUTBOX_SENT_RETENTION_DAYS,
  RETENTION_CHUNK_SIZE,
  RETENTION_MAX_CHUNKS_PER_TABLE,
  USER_SESSION_RETENTION_DAYS,
  retentionDays,
} from "./scheduler.config";

export interface RetentionResult {
  userSessions: number;
  apiAccessLogs: number;
  sentOutboxEvents: number;
}

function thresholdFor(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * 保持期間を過ぎた行の削除。
 *
 * 導入前は期限切れ行を削除する処理がアプリ全体に存在せず、有効期限30日のセッションも、
 * 外部APIの全呼び出しを記録するアクセスログも、増え続けるだけだった。数か月〜1年単位で
 * クエリ性能とバックアップ時間に効いてくる。
 *
 * ## 削除するもの
 *
 * - `user_sessions`: 有効期限切れから保持期間を過ぎたもの。ログインデバイス一覧は
 *   元から「失効済み・期限切れを除く」条件で引いている (`SessionManagementService`) ため、
 *   削除しても利用者から見える情報は変わらない。
 * - `api_access_logs`: 記録から保持期間を過ぎたもの。
 * - `integration_outbox`: **送信済み(SENT)のみ**。PENDING/PROCESSINGは未送信、
 *   FAILEDは再送上限に達して人手の対応を待っている状態なので、いずれも削除しない。
 *
 * ## 意図的に削除しないもの
 *
 * - `audit_logs` / `ove_transactions`: DBトリガーでDELETEを禁止している (設計どおり)。
 *   長期保管が必要なため、削除ではなくアーカイブ方針を別途決める。
 * - `inbound_events`: 外部イベントの重複受信を防ぐ記録。古い行を消すと、同じ
 *   `event_id`が再送されたときに二重処理になりうる (報酬の二重付与など)。
 *   表のサイズより取り違えの実害が大きいため、本ジョブでは対象外とする。
 *
 * ## 実行方法
 *
 * 一度に大量削除すると長時間ロックを保持してしまうため、一定件数ずつに分けて削除し、
 * 1回の実行あたりの上限を設ける。上限に達した分は次回の実行に持ち越す。
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async purgeExpiredData(now: Date = new Date()): Promise<RetentionResult> {
    const [userSessions, apiAccessLogs, sentOutboxEvents] = [
      await this.purgeUserSessions(now),
      await this.purgeApiAccessLogs(now),
      await this.purgeSentOutboxEvents(now),
    ];
    return { userSessions, apiAccessLogs, sentOutboxEvents };
  }

  private async purgeUserSessions(now: Date): Promise<number> {
    const threshold = thresholdFor(
      retentionDays("USER_SESSION_RETENTION_DAYS", USER_SESSION_RETENTION_DAYS),
      now,
    );
    return this.deleteInChunks("user_sessions", async (take) => {
      const rows = await this.db.userSession.findMany({
        where: { expiresAt: { lt: threshold } },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      const { count } = await this.db.userSession.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      return count;
    });
  }

  private async purgeApiAccessLogs(now: Date): Promise<number> {
    const threshold = thresholdFor(
      retentionDays("API_ACCESS_LOG_RETENTION_DAYS", API_ACCESS_LOG_RETENTION_DAYS),
      now,
    );
    return this.deleteInChunks("api_access_logs", async (take) => {
      const rows = await this.db.apiAccessLog.findMany({
        where: { createdAt: { lt: threshold } },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      const { count } = await this.db.apiAccessLog.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      return count;
    });
  }

  private async purgeSentOutboxEvents(now: Date): Promise<number> {
    const threshold = thresholdFor(
      retentionDays("OUTBOX_SENT_RETENTION_DAYS", OUTBOX_SENT_RETENTION_DAYS),
      now,
    );
    return this.deleteInChunks("integration_outbox", async (take) => {
      const rows = await this.db.integrationOutbox.findMany({
        // SENT以外は未送信または人手の対応待ちなので、保持期間に関わらず残す。
        where: { status: "SENT", processedAt: { lt: threshold } },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      const { count } = await this.db.integrationOutbox.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      return count;
    });
  }

  /**
   * `deleteChunk`が0を返すか、1回の実行あたりの上限に達するまで繰り返す。
   * 上限に達した場合は残りを次回に持ち越し、その旨をログに残す。
   */
  private async deleteInChunks(table: string, deleteChunk: (take: number) => Promise<number>): Promise<number> {
    let total = 0;
    for (let chunk = 0; chunk < RETENTION_MAX_CHUNKS_PER_TABLE; chunk++) {
      const deleted = await deleteChunk(RETENTION_CHUNK_SIZE);
      total += deleted;
      if (deleted < RETENTION_CHUNK_SIZE) return total;
    }
    this.logger.warn(
      `data retention: reached the per-run limit for ${table} (${total} rows deleted); the rest is carried over to the next run`,
    );
    return total;
  }
}
