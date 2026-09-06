"use client";

import { useState } from "react";
import {
  apiFetch,
  ApiError,
  SUPPORT_CATEGORY_LABEL,
  SUPPORT_STATUS_LABEL,
  type SupportInquiryItem,
  type SupportInquiryStatus,
} from "@/lib/api";

const NEXT_STATUS: SupportInquiryStatus[] = ["OPEN", "IN_PROGRESS", "ANSWERED", "CLOSED"];

/**
 * 問い合わせ1件。読む・状態を変える・返信する (docs/support-inquiries.md)。
 * 一覧ページの見通しを保つため切り出している。
 */
export default function SupportInquiryCard({
  inquiry,
  onDone,
  onError,
}: {
  inquiry: SupportInquiryItem;
  onDone: (message: string) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [title, setTitle] = useState("お問い合わせへのご回答");
  const [body, setBody] = useState("");
  const [note, setNote] = useState(inquiry.internal_note ?? "");
  const [busy, setBusy] = useState(false);

  async function call(path: string, payload: unknown, done: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/admin/support-inquiries/${inquiry.id}/${path}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await onDone(done);
      setReplying(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "更新に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-sengoku-border p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-sengoku-navy-deep px-2 py-0.5">
          {SUPPORT_STATUS_LABEL[inquiry.status]}
        </span>
        <span className="text-sengoku-muted">{SUPPORT_CATEGORY_LABEL[inquiry.category]}</span>
        <span className="text-sengoku-faint">{inquiry.inquiry_code}</span>
        <span className="ml-auto text-sengoku-faint">
          {new Date(inquiry.created_at).toLocaleString("ja-JP")}
        </span>
      </div>

      <p className="mb-2 text-xs text-sengoku-muted">
        <a href={`/accounts?search=${inquiry.account_code}`} className="underline">
          {inquiry.account_code}
        </a>
        {inquiry.display_name && <span className="ml-2">{inquiry.display_name}</span>}
      </p>

      <p className="mb-3 whitespace-pre-wrap break-words rounded bg-sengoku-navy-deep p-3 text-sm">
        {inquiry.message}
      </p>

      <label className="mb-3 block text-xs">
        <span className="mb-1 block text-sengoku-muted">運用メモ (利用者には見えません)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={inquiry.status}
          onChange={(e) =>
            call("status", { status: e.target.value, internalNote: note }, "状態を変更しました")
          }
          disabled={busy}
          className="rounded border border-sengoku-border bg-transparent px-2 py-1 text-xs"
        >
          {NEXT_STATUS.map((value) => (
            <option key={value} value={value}>
              {SUPPORT_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => call("status", { status: inquiry.status, internalNote: note }, "メモを保存しました")}
          disabled={busy}
          className="rounded border border-sengoku-border px-3 py-1 text-xs disabled:opacity-50"
        >
          メモを保存
        </button>
        <button
          type="button"
          onClick={() => setReplying((v) => !v)}
          disabled={busy}
          className="rounded bg-sengoku-accent px-3 py-1 text-xs text-black disabled:opacity-50"
        >
          {replying ? "返信をやめる" : "返信する"}
        </button>
      </div>

      {replying && (
        <div className="mt-3 border-t border-sengoku-border pt-3">
          <p className="mb-2 text-xs text-sengoku-muted">
            この方だけに見えるお知らせが1件作られます。
          </p>
          <label className="mb-2 block text-xs">
            <span className="mb-1 block text-sengoku-muted">件名</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="mb-2 block text-xs">
            <span className="mb-1 block text-sengoku-muted">本文</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => call("reply", { title, message: body }, "返信しました")}
            disabled={busy || !body.trim()}
            className="rounded bg-sengoku-accent px-3 py-1 text-xs text-black disabled:opacity-50"
          >
            {busy ? "送信中..." : "この内容で返信する"}
          </button>
        </div>
      )}

      {inquiry.answered_at && (
        <p className="mt-2 text-[11px] text-sengoku-faint">
          {new Date(inquiry.answered_at).toLocaleString("ja-JP")} に返信済み
        </p>
      )}
    </section>
  );
}
