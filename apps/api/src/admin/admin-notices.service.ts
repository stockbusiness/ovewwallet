import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { LineBroadcastService } from "../notices/line-broadcast.service";

export interface CreateNoticeParams {
  title: string;
  message: string;
  importance?: "NORMAL" | "IMPORTANT";
  /** 未来日時を指定すると、その日時になるまで一般ユーザーには表示されない (予約投稿)。未指定なら即時公開。 */
  publishedAt?: string;
}

/** ウォレットホーム画面「お知らせ」の作成・一覧・アーカイブ (削除はせず非表示にする)。 */
@Injectable()
export class AdminNoticesService {
  private readonly logger = new Logger(AdminNoticesService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly lineBroadcast: LineBroadcastService,
  ) {}

  /**
   * 管理画面のお知らせ一覧。全員向け (`oveAccountId`がnull) のみを返す。
   *
   * 失効予告 (`ExpiryNoticeService`) が作る個別通知は利用者数に比例して増えるため、
   * ここに混ぜると管理者が作ったお知らせが埋もれ、件数も無制限になる。
   * この画面は全員向けお知らせの作成・管理が目的なので、対象から外す。
   */
  async list() {
    return this.db.notice.findMany({
      where: { oveAccountId: null },
      orderBy: { publishedAt: "desc" },
    });
  }

  async create(params: CreateNoticeParams, adminId: string) {
    const publishedAt = params.publishedAt ? new Date(params.publishedAt) : new Date();
    const isScheduledForFuture = publishedAt.getTime() > Date.now();

    const notice = await this.db.notice.create({
      data: {
        id: generateId(),
        title: params.title,
        message: params.message,
        status: "PUBLISHED",
        importance: params.importance ?? "NORMAL",
        publishedAt,
        createdBy: adminId,
      },
    });

    // 予約投稿 (未来のpublishedAt) の場合、公開時刻になった時点で改めてLINE配信する
    // 仕組みはこのリポジトリには無い (cron等の外部スケジューラ未接続、
    // docs/credit-expiry.md「運用」と同じ制約)。公開前に配信してしまうと画面にはまだ
    // 表示されていないお知らせをLINEで告知することになり矛盾するため、
    // 予約投稿の場合はLINE配信自体をスキップする (今後の課題)。
    if (!isScheduledForFuture) {
      // LINE配信の失敗でお知らせ作成自体を失敗させない (wallet/page.tsxのお知らせ取得を
      // 本体データ取得と別try/catchにしているのと同じ「補助的な機能は本体を巻き込まない」方針)。
      try {
        const prefix = params.importance === "IMPORTANT" ? "【重要なお知らせ】" : "【お知らせ】";
        await this.lineBroadcast.broadcastText(`${prefix}${params.title}\n${params.message}`);
      } catch (err) {
        this.logger.warn(`LINE broadcast failed for notice ${notice.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return notice;
  }

  async archive(id: string) {
    const existing = await this.db.notice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`notice ${id} not found`);
    return this.db.notice.update({ where: { id }, data: { status: "ARCHIVED" } });
  }
}
