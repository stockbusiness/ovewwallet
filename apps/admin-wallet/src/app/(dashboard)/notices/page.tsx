"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, type NoticeItem } from "@/lib/api";

export default function NoticesPage() {
  const router = useRouter();
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [importance, setImportance] = useState<"NORMAL" | "IMPORTANT">("NORMAL");
  const [publishedAt, setPublishedAt] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<NoticeItem[]>("/api/v1/admin/notices");
      setNotices(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function createNotice() {
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/v1/admin/notices", {
        method: "POST",
        body: JSON.stringify({
          title,
          message: body,
          importance,
          publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined,
        }),
      });
      setMessage(publishedAt && new Date(publishedAt) > new Date() ? "お知らせを予約投稿しました" : "お知らせを公開しました");
      setTitle("");
      setBody("");
      setImportance("NORMAL");
      setPublishedAt("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "作成に失敗しました");
    }
  }

  async function archiveNotice(id: string) {
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/notices/${id}/archive`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "非表示化に失敗しました");
    }
  }

  return (
    <>
        <h1 className="mb-1 text-xl font-bold">お知らせ管理</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          ここで作成したお知らせは、ウォレットホーム画面の「お知らせ」に新しい順で表示されます。
          非表示化は削除ではなく、ユーザー画面から見えなくするだけです。
        </p>

        <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-3 text-sm font-semibold">新規お知らせ作成</h2>
          <div className="flex flex-col gap-3">
            <label className="text-xs">
              タイトル
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              本文
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              重要度
              <select
                value={importance}
                onChange={(e) => setImportance(e.target.value as "NORMAL" | "IMPORTANT")}
                className="mt-1 block w-40 rounded-md border border-sengoku-border px-2 py-1 text-sm"
              >
                <option value="NORMAL">通常</option>
                <option value="IMPORTANT">重要</option>
              </select>
            </label>
            <label className="text-xs">
              公開日時 (空欄なら即時公開、未来日時を指定すると予約投稿)
              <input
                type="datetime-local"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                className="mt-1 block w-64 rounded-md border border-sengoku-border px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={createNotice}
              disabled={!title || !body}
              className="self-start rounded-md bg-sengoku-gold px-4 py-1.5 text-sm text-sengoku-navy-deep disabled:opacity-50"
            >
              公開する
            </button>
          </div>
          {message && <p className="mt-2 text-sm text-sengoku-green">{message}</p>}
          {error && <p className="mt-2 text-sm text-sengoku-red">{error}</p>}
        </section>

        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">公開日時</th>
              <th className="p-3">タイトル</th>
              <th className="p-3">本文</th>
              <th className="p-3">重要度</th>
              <th className="p-3">状態</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {notices.map((n) => (
              <tr key={n.id} className="border-t border-sengoku-border align-top">
                <td className="p-3">
                  {new Date(n.publishedAt).toLocaleString("ja-JP")}
                  {new Date(n.publishedAt) > new Date() && (
                    <span className="ml-2 rounded-full bg-sengoku-gold-soft/10 px-2 py-0.5 text-xs font-semibold text-sengoku-gold-soft">
                      公開予定
                    </span>
                  )}
                </td>
                <td className="p-3">{n.title}</td>
                <td className="max-w-sm p-3 text-sengoku-muted">{n.message}</td>
                <td className="p-3">
                  {n.importance === "IMPORTANT" ? (
                    <span className="font-semibold text-sengoku-red">重要</span>
                  ) : (
                    <span className="text-sengoku-faint">通常</span>
                  )}
                </td>
                <td className="p-3">
                  <span className={n.status === "PUBLISHED" ? "text-sengoku-green" : "text-sengoku-faint"}>
                    {n.status}
                  </span>
                </td>
                <td className="p-3">
                  {n.status === "PUBLISHED" && (
                    <button onClick={() => archiveNotice(n.id)} className="text-xs text-sengoku-gold underline">
                      非表示にする
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {notices.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-sengoku-faint">
                  お知らせはまだありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </>  );
}
