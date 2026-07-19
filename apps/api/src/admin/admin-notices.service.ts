import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { LineBroadcastService } from "../notices/line-broadcast.service";

export interface CreateNoticeParams {
  title: string;
  message: string;
}

/** ウォレットホーム画面「お知らせ」の作成・一覧・アーカイブ (削除はせず非表示にする)。 */
@Injectable()
export class AdminNoticesService {
  private readonly logger = new Logger(AdminNoticesService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly lineBroadcast: LineBroadcastService,
  ) {}

  async list() {
    return this.db.notice.findMany({ orderBy: { publishedAt: "desc" } });
  }

  async create(params: CreateNoticeParams, adminId: string) {
    const notice = await this.db.notice.create({
      data: {
        id: generateId(),
        title: params.title,
        message: params.message,
        status: "PUBLISHED",
        createdBy: adminId,
      },
    });

    // LINE配信の失敗でお知らせ作成自体を失敗させない (wallet/page.tsxのお知らせ取得を
    // 本体データ取得と別try/catchにしているのと同じ「補助的な機能は本体を巻き込まない」方針)。
    try {
      await this.lineBroadcast.broadcastText(`【お知らせ】${params.title}\n${params.message}`);
    } catch (err) {
      this.logger.warn(`LINE broadcast failed for notice ${notice.id}: ${err instanceof Error ? err.message : err}`);
    }

    return notice;
  }

  async archive(id: string) {
    const existing = await this.db.notice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`notice ${id} not found`);
    return this.db.notice.update({ where: { id }, data: { status: "ARCHIVED" } });
  }
}
