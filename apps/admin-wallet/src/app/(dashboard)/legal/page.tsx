"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, ApiError, type LegalDocument } from "@/lib/api";

const SLUG_LABELS: Record<LegalDocument["slug"], string> = {
  terms: "利用規約",
  privacy: "プライバシーポリシー",
  company: "運営会社・会社情報",
};

/**
 * 利用規約・プライバシーポリシー・会社情報の編集 (docs/legal-documents.md)。
 *
 * 以前は利用規約がウォレットのコードに直接書かれており、文言の修正に
 * デプロイが必要だった。プライバシーポリシーと会社情報はそもそも無かった。
 */
export default function LegalPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<LegalDocument[] | null>(null);
  const [slug, setSlug] = useState<LegalDocument["slug"]>("terms");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [version, setVersion] = useState("");
  const [published, setPublished] = useState(false);
  const [reason, setReason] = useState("");

  const current = docs?.find((d) => d.slug === slug) ?? null;

  const applyToForm = useCallback((doc: LegalDocument) => {
    setTitle(doc.title);
    setBody(doc.body);
    setVersion(doc.version);
    setPublished(doc.published);
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<LegalDocument[]>("/api/v1/admin/legal");
      setDocs(list);
      const first = list.find((d) => d.slug === slug);
      if (first) applyToForm(first);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }, [router, slug, applyToForm]);

  useEffect(() => {
    load();
    // slug を変えたときも読み直す (未保存の編集は破棄される)
  }, [load]);

  function selectSlug(next: LegalDocument["slug"]) {
    setSlug(next);
    setMessage(null);
    setError(null);
    setReason("");
    const doc = docs?.find((d) => d.slug === next);
    if (doc) applyToForm(doc);
  }

  const versionChanged = !!current && current.version !== version.trim();
  const reconsentWarning = slug === "terms" && versionChanged;

  async function save() {
    if (!reason.trim()) {
      setError("変更理由を入力してください");
      return;
    }
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const updated = await apiFetch<LegalDocument>(`/api/v1/admin/legal/${slug}`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body,
          version: version.trim(),
          published,
          reason: reason.trim(),
        }),
      });
      setDocs((prev) => (prev ?? []).map((d) => (d.slug === updated.slug ? updated : d)));
      applyToForm(updated);
      setReason("");
      setMessage(
        slug === "terms" && versionChanged
          ? "保存しました。バージョンを変更したため、全利用者に再同意が求められます。"
          : "保存しました",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">利用規約・プライバシーポリシー・会社情報</h1>
      <p className="mb-4 text-xs text-sengoku-muted">
        ウォレットの画面に出る文書をここから編集します。保存した時点で反映されます (デプロイは不要です)。
      </p>

      <HelpPanel storageKey="legal" title="このページについて・書き方">
        <div>
          <p className="font-semibold text-sengoku-text">書き方</p>
          <p>
            本文は文章をそのまま書いてください。行頭に <code>## </code> (シャープ2つと半角スペース)
            を付けた行は見出しになります。空行で段落が分かれます。HTMLタグは使えません
            (書いてもそのまま文字として表示されます)。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">公開する</p>
          <p>
            「公開する」がオフの間、利用者側の画面には表示されず、メニューにもリンクが出ません。
            書きかけの文書が利用者に見えないようにするためです。書き終えてから公開してください。
          </p>
        </div>
        <p className="text-sengoku-gold-soft">
          重要: <strong>利用規約のバージョンを変更すると、全利用者に再同意が求められます。</strong>
          同意するまで、その方は残高照会などの閲覧はできますが、更新を伴う操作ができなくなります。
          誤字の修正など、同意を取り直す必要がない変更では<strong>バージョンを変えないでください</strong>。
          逆に、内容を実質的に変えたのにバージョンを据え置くと、利用者は新しい内容に同意しないまま
          使い続けることになります。
        </p>
        <p>
          プライバシーポリシーと会社情報には下書きが入っています。角括弧で囲まれた箇所を自社の情報で埋め、
          <strong>法務の確認を受けてから</strong>公開してください。
        </p>
      </HelpPanel>

      {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}
      {message && <p className="mb-3 text-sm text-sengoku-green">{message}</p>}

      <div className="mb-4 flex gap-2">
        {(Object.keys(SLUG_LABELS) as LegalDocument["slug"][]).map((key) => {
          const doc = docs?.find((d) => d.slug === key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectSlug(key)}
              className={
                slug === key
                  ? "rounded-md bg-sengoku-gold px-3 py-1.5 text-xs font-bold text-sengoku-navy-deep"
                  : "rounded-md border border-sengoku-border px-3 py-1.5 text-xs text-sengoku-muted"
              }
            >
              {SLUG_LABELS[key]}
              {doc && !doc.published && <span className="ml-1 text-[10px]">(未公開)</span>}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="mb-4 rounded-lg border border-sengoku-border bg-sengoku-navy-deep p-3 text-xs text-sengoku-muted">
          <p>
            現在: バージョン <span className="font-mono">{current.version}</span> /{" "}
            {current.published ? "公開中" : <span className="text-sengoku-gold-soft">未公開</span>}
          </p>
          {current.updatedAt && (
            <p className="mt-1">
              最終更新: {new Date(current.updatedAt).toLocaleString("ja-JP")}
              {current.updatedBy ? ` (管理者ID: ${current.updatedBy})` : ""}
            </p>
          )}
        </div>
      )}

      {docs && (
        <div className="space-y-4 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <div>
            <label className="block text-xs font-medium text-sengoku-muted">タイトル</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-sengoku-muted">本文</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={22}
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 font-mono text-xs leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-sengoku-muted">バージョン</label>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="mt-1 block w-32 rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
            {reconsentWarning && (
              <p className="mt-2 rounded-md bg-sengoku-red/10 p-2 text-xs text-sengoku-red">
                バージョンを {current?.version} から {version.trim()} へ変更しようとしています。
                保存すると<strong>全利用者に再同意が求められます</strong>。
                文言の微修正であれば、バージョンは変えずに保存してください。
              </p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-sengoku-muted">
              <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              公開する (オフの間は利用者側に表示されません)
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-sengoku-muted">
              変更理由 (監査ログに記録されます)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: お客様情報の取り扱いについて追記"
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-sengoku-gold px-4 py-1.5 text-sm text-sengoku-navy-deep disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      )}
    </>
  );
}
