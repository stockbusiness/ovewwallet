import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

export interface CreateNoticeParams {
  title: string;
  message: string;
}

/** ウォレットホーム画面「お知らせ」の作成・一覧・アーカイブ (削除はせず非表示にする)。 */
@Injectable()
export class AdminNoticesService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async list() {
    return this.db.notice.findMany({ orderBy: { publishedAt: "desc" } });
  }

  async create(params: CreateNoticeParams, adminId: string) {
    return this.db.notice.create({
      data: {
        id: generateId(),
        title: params.title,
        message: params.message,
        status: "PUBLISHED",
        createdBy: adminId,
      },
    });
  }

  async archive(id: string) {
    const existing = await this.db.notice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`notice ${id} not found`);
    return this.db.notice.update({ where: { id }, data: { status: "ARCHIVED" } });
  }
}
