"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@ove/shared-ui";
import { apiFetch, ApiError, type LegalDocument } from "@/lib/api";
import { parseLegalBody } from "@/lib/legal-body";

/**
 * 利用規約・プライバシーポリシー・会社情報の表示 (docs/legal-documents.md)。
 *
 * 本文はAPIから取る。管理画面で直した文言が、再ビルド無しでそのまま出るようにするため。
 * 段落・見出しはテキストとして描画する (HTMLとして解釈しない)。
 */
export function LegalDocumentView({ slug, backHref }: { slug: string; backHref: string }) {
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDoc(await apiFetch<LegalDocument>(`/api/v1/legal/${slug}`));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "この文書はまだ公開されていません。"
          : "読み込みに失敗しました",
      );
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="flex flex-col gap-4 px-4 pb-10 pt-6">
      <header className="flex items-center gap-3">
        <Link href={backHref} className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">{doc?.title ?? "　"}</h1>
      </header>

      {doc && <p className="text-xs text-sengoku-faint">バージョン {doc.version}</p>}
      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}
      {!error && !doc && <p className="text-sm text-sengoku-muted">読み込み中...</p>}

      {doc && (
        <div className="space-y-4 text-sm leading-relaxed text-sengoku-muted">
          {parseLegalBody(doc.body).map((block, index) =>
            block.kind === "heading" ? (
              <h2 key={index} className="text-sm font-bold text-sengoku-text">
                {block.text}
              </h2>
            ) : (
              <p key={index} className="whitespace-pre-line">
                {block.text}
              </p>
            ),
          )}
        </div>
      )}
    </main>
  );
}
