import { z } from "zod";

/**
 * 法的文書の更新 (docs/legal-documents.md)。省略した項目は現状維持。
 *
 * 本文はHTMLではなくプレーンテキストとして扱う (`## `始まりの行が見出し)。
 * 管理画面からの入力がそのままスクリプトとして動く経路を作らないため。
 */
export const LegalDocumentUpdateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  body: z.string().min(1).max(100_000).optional(),
  version: z.string().min(1).max(20).optional(),
  published: z.boolean().optional(),
  reason: z.string().min(1),
});
