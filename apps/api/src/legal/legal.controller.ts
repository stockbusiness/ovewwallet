import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { LegalDocumentsService } from "./legal-documents.service";
import { isLegalSlug } from "./legal-slugs";

/**
 * 利用規約・プライバシーポリシー・会社情報の公開参照 (docs/legal-documents.md)。
 *
 * **認証しない**。規約は登録前に読めなければ意味がなく、会社情報も同じ。
 * 未公開の文書は404にする (書きかけを見せない)。
 */
@ApiTags("legal")
@Controller("api/v1/legal")
export class LegalController {
  constructor(private readonly legal: LegalDocumentsService) {}

  /** 読める文書のスラッグ一覧。画面がメニューの出し分けに使う。 */
  @Get()
  async list() {
    return { slugs: await this.legal.listPublishedSlugs() };
  }

  @Get(":slug")
  async get(@Param("slug") slug: string) {
    if (!isLegalSlug(slug)) throw new NotFoundException("legal document not found");
    return this.legal.getPublished(slug);
  }
}
