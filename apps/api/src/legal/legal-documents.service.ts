import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { LegalDocument, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { LEGAL_SLUGS, TERMS_SLUG, type LegalSlug } from "./legal-slugs";

/**
 * 規約バージョンをキャッシュする秒数。
 *
 * この値は**認証が必要なリクエストのたびに**参照される
 * (`SessionAuthGuard.assertTermsConsent`)。毎回DBを引くのは無駄なので短く持つ。
 * 逆に長く持つと、管理画面でバージョンを上げてから再同意が始まるまでが延びる。
 * 数十秒の遅れは運用上問題にならないため、短めの固定値にしている。
 */
const TERMS_VERSION_CACHE_MS = 30_000;

/** 文書が1つも無いDB (マイグレーション前の環境やテスト) でも動くようにする既定値。 */
export const FALLBACK_TERMS_VERSION = "1.0";

export interface LegalDocumentView {
  slug: LegalSlug;
  title: string;
  body: string;
  version: string;
  published: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

function toView(doc: LegalDocument): LegalDocumentView {
  return {
    slug: doc.slug as LegalSlug,
    title: doc.title,
    body: doc.body,
    version: doc.version,
    published: doc.published,
    updatedAt: doc.updatedAt.toISOString(),
    updatedBy: doc.updatedBy,
  };
}

/**
 * 利用規約・プライバシーポリシー・会社情報の参照と更新
 * (`docs/legal-documents.md`)。
 */
@Injectable()
export class LegalDocumentsService {
  private termsVersionCache: { value: string; expiresAt: number } | null = null;

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** 利用者向け。未公開の文書は「無い」ものとして扱う。 */
  async getPublished(slug: LegalSlug): Promise<LegalDocumentView> {
    const doc = await this.db.legalDocument.findUnique({ where: { slug } });
    if (!doc || !doc.published) throw new NotFoundException("legal document not found");
    return toView(doc);
  }

  /** 利用者向け。どの文書が読める状態かを画面が判断するために使う。 */
  async listPublishedSlugs(): Promise<LegalSlug[]> {
    const docs = await this.db.legalDocument.findMany({
      where: { published: true },
      select: { slug: true },
    });
    const published = new Set(docs.map((d) => d.slug));
    // 表示順を`LEGAL_SLUGS`の並びに固定する (DBの返す順に左右されないように)。
    return LEGAL_SLUGS.filter((slug) => published.has(slug));
  }

  /** 管理画面向け。未公開のものも含めて全件返す。 */
  async listAll(): Promise<LegalDocumentView[]> {
    const docs = await this.db.legalDocument.findMany();
    const bySlug = new Map(docs.map((d) => [d.slug, d]));
    return LEGAL_SLUGS.flatMap((slug) => {
      const doc = bySlug.get(slug);
      return doc ? [toView(doc)] : [];
    });
  }

  async getForAdmin(slug: LegalSlug): Promise<LegalDocumentView> {
    const doc = await this.db.legalDocument.findUnique({ where: { slug } });
    if (!doc) throw new NotFoundException("legal document not found");
    return toView(doc);
  }

  /**
   * 現行の利用規約バージョン。`ove_accounts.terms_version`との突き合わせに使う。
   *
   * 認証が必要なリクエストのたびに呼ばれるため短時間キャッシュする。DBに文書が
   * 無ければ既定値へ落とす (バージョンが引けないことを理由に、全利用者を
   * ログイン不能にしない)。
   */
  async currentTermsVersion(now: number = Date.now()): Promise<string> {
    if (this.termsVersionCache && this.termsVersionCache.expiresAt > now) {
      return this.termsVersionCache.value;
    }
    const doc = await this.db.legalDocument.findUnique({
      where: { slug: TERMS_SLUG },
      select: { version: true },
    });
    const value = doc?.version ?? FALLBACK_TERMS_VERSION;
    this.termsVersionCache = { value, expiresAt: now + TERMS_VERSION_CACHE_MS };
    return value;
  }

  /** 更新直後から新しいバージョンで判定できるようにする。 */
  invalidateTermsVersionCache(): void {
    this.termsVersionCache = null;
  }

  async update(
    slug: LegalSlug,
    params: { title?: string; body?: string; version?: string; published?: boolean },
  ): Promise<LegalDocumentView> {
    const existing = await this.db.legalDocument.findUnique({ where: { slug } });
    if (!existing) throw new NotFoundException("legal document not found");

    const updated = await this.db.legalDocument.update({
      where: { slug },
      data: {
        title: params.title ?? existing.title,
        body: params.body ?? existing.body,
        version: params.version ?? existing.version,
        published: params.published ?? existing.published,
      },
    });
    if (slug === TERMS_SLUG) this.invalidateTermsVersionCache();
    return toView(updated);
  }
}
