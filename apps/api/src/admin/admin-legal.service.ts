import { Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { LegalDocumentsService, type LegalDocumentView } from "../legal/legal-documents.service";
import { TERMS_SLUG, type LegalSlug } from "../legal/legal-slugs";

export interface LegalDocumentUpdate {
  title?: string;
  body?: string;
  version?: string;
  published?: boolean;
}

/**
 * 法的文書の編集と監査ログ (docs/legal-documents.md)。
 *
 * 利用規約のバージョン変更は、**全利用者に再同意を求める**という利用者影響の
 * 大きい操作になる。何がどう変わったのかを後から追えるよう、前後のバージョンと
 * 公開状態を監査ログへ残す (本文は長いので、変わったかどうかだけを残す)。
 */
@Injectable()
export class AdminLegalService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly legal: LegalDocumentsService,
  ) {}

  async list(): Promise<LegalDocumentView[]> {
    return this.legal.listAll();
  }

  async get(slug: LegalSlug): Promise<LegalDocumentView> {
    return this.legal.getForAdmin(slug);
  }

  async update(
    slug: LegalSlug,
    params: LegalDocumentUpdate,
    adminId: string,
    reason: string,
  ): Promise<LegalDocumentView> {
    const before = await this.legal.getForAdmin(slug);
    const after = await this.legal.update(slug, params);

    const versionChanged = before.version !== after.version;

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "LEGAL_DOCUMENT_UPDATED",
        targetType: "legal_document",
        targetId: slug,
        result: "SUCCESS",
        reason,
        beforeData: {
          version: before.version,
          published: before.published,
          title: before.title,
        } as Prisma.InputJsonValue,
        afterData: {
          version: after.version,
          published: after.published,
          title: after.title,
          bodyChanged: before.body !== after.body,
          // 規約のバージョンが変わった = 全利用者へ再同意を求めた、ということ。
          // 一番影響の大きい操作なので、ログを見ただけで分かるようにしておく。
          reconsentRequired: slug === TERMS_SLUG && versionChanged,
        } as Prisma.InputJsonValue,
      },
    });

    return after;
  }
}
