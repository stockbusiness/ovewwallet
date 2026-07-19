"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type NoticeItem } from "@/lib/api";

export default function NoticesPage() {
  const router = useRouter();
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

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
        body: JSON.stringify({ title, message: body }),
      });
      setMessage("お知らせを公開しました");
      setTitle("");
      setBody("");
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
    <div>
      <AdminNav />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-1 text-xl font-bold">お知らせ管理</h1>
        <p className="mb-4 text-xs text-neutral-500">
          ここで作成したお知らせは、ウォレットホーム画面の「お知らせ」に新しい順で表示されます。
          非表示化は削除ではなく、ユーザー画面から見えなくするだけです。
        </p>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">新規お知らせ作成</h2>
          <div className="flex flex-col gap-3">
            <label className="text-xs">
              タイトル
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              本文
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={createNotice}
              disabled={!title || !body}
              className="self-start rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              公開する
            </button>
          </div>
          {message && <p className="mt-2 text-sm text-emerald-600">{message}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>

        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">公開日時</th>
              <th className="p-3">タイトル</th>
              <th className="p-3">本文</th>
              <th className="p-3">状態</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {notices.map((n) => (
              <tr key={n.id} className="border-t border-neutral-100 align-top">
                <td className="p-3">{new Date(n.publishedAt).toLocaleString("ja-JP")}</td>
                <td className="p-3">{n.title}</td>
                <td className="max-w-sm p-3 text-neutral-600">{n.message}</td>
                <td className="p-3">
                  <span className={n.status === "PUBLISHED" ? "text-emerald-600" : "text-neutral-400"}>
                    {n.status}
                  </span>
                </td>
                <td className="p-3">
                  {n.status === "PUBLISHED" && (
                    <button onClick={() => archiveNotice(n.id)} className="text-xs text-brand-600 underline">
                      非表示にする
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {notices.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-neutral-400">
                  お知らせはまだありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
