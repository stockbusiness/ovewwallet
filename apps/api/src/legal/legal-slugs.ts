/** 画面に出す法的文書の種類 (docs/legal-documents.md)。増やすときはここに足す。 */
export const LEGAL_SLUGS = ["terms", "privacy", "company"] as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

/**
 * 利用規約のスラッグ。`ove_accounts.terms_version`と突き合わせる版番号は
 * この文書が持つ (docs/terms-consent.md)。
 */
export const TERMS_SLUG = "terms" satisfies LegalSlug;
