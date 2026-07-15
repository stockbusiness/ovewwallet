"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import {
  apiFetch,
  ApiError,
  FEATURE_FLAG_LABELS,
  type FeatureFlags,
  type OutboxEventItem,
} from "@/lib/api";

const STATUS_LABEL: Record<OutboxEventItem["status"], string> = {
  PENDING: "再送待ち",
  PROCESSING: "処理中",
  SENT: "送信済み",
  FAILED: "失敗(上限到達)",
};

const STATUS_CLASS: Record<OutboxEventItem["status"], string> = {
  PENDING: "text-amber-600",
  PROCESSING: "text-blue-600",
  SENT: "text-emerald-600",
  FAILED: "text-red-600",
};

export default function OutboxPage() {
  const router = useRouter();
  const [events, setEvents] = useState<OutboxEventItem[]>([]);
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [destinationFilter, setDestinationFilter] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const query = [
        statusFilter ? `status=${statusFilter}` : "",
        destinationFilter ? `destinationService=${encodeURIComponent(destinationFilter)}` : "",
      ]
        .filter(Boolean)
        .join("&");
      const [eventList, flagList] = await Promise.all([
        apiFetch<OutboxEventItem[]>(`/api/v1/admin/outbox${query ? `?${query}` : ""}`),
        apiFetch<FeatureFlags>("/api/v1/admin/feature-flags"),
      ]);
      setEvents(eventList);
      setFlags(flagList);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push("/login");
    }
  }, [router, statusFilter, destinationFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function dispatchNow() {
    setMessage("");
    try {
      const result = await apiFetch<{ processed: number; failed: number }>("/api/v1/admin/outbox/dispatch", {
        method: "POST",
      });
      setMessage(`処理対象 ${result.processed}件、失敗 ${result.failed}件`);
      await load();
    } catch {
      setMessage("処理中にエラーが発生しました");
    }
  }

  async function retry(id: string) {
    setMessage("");
    try {
      await apiFetch(`/api/v1/admin/outbox/${id}/retry`, { method: "POST" });
      await load();
    } catch {
      setMessage("再送の予約に失敗しました");
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="mb-4 text-xl font-bold">外部連携キュー (Outbox)</h1>
        <p className="mb-4 text-xs text-neutral-500">
          代理店システム等への連携イベントの送信状況。開発ガイドライン10章 (Transactional Outbox) に基づき、
          送信失敗時は指数バックオフで自動再送し、上限到達後は「失敗」として手動再送が必要になる。
        </p>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Feature Flag (開発ガイドライン13章)</h2>
          {flags ? (
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(FEATURE_FLAG_LABELS) as Array<keyof FeatureFlags>).map((key) => (
                <li key={key} className="flex items-center justify-between rounded border border-neutral-100 px-3 py-2">
                  <span>{FEATURE_FLAG_LABELS[key]}</span>
                  <span className={flags[key] ? "font-semibold text-emerald-600" : "text-neutral-400"}>
                    {flags[key] ? "ON" : "OFF"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-400">読み込み中...</p>
          )}
          <p className="mt-3 text-xs text-neutral-400">
            値は環境変数から読み取る (DB管理外)。この画面からの変更はできない。
          </p>
        </section>

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor="statusFilter">ステータス:</label>
          <select
            id="statusFilter"
            className="rounded border border-neutral-300 px-2 py-1"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">すべて</option>
            <option value="PENDING">再送待ち</option>
            <option value="PROCESSING">処理中</option>
            <option value="SENT">送信済み</option>
            <option value="FAILED">失敗(上限到達)</option>
          </select>
          <label htmlFor="destinationFilter">連携先:</label>
          <input
            id="destinationFilter"
            className="rounded border border-neutral-300 px-2 py-1"
            placeholder="例: AGENCY_SYSTEM"
            value={destinationFilter}
            onChange={(e) => setDestinationFilter(e.target.value)}
          />
          <button onClick={dispatchNow} className="rounded bg-brand-600 px-3 py-1 text-white">
            再送期日到来分をまとめて処理
          </button>
          {message && <span className="text-neutral-500">{message}</span>}
        </div>

        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">発生日時</th>
              <th className="p-3">イベント種別</th>
              <th className="p-3">連携先</th>
              <th className="p-3">対象</th>
              <th className="p-3">ステータス</th>
              <th className="p-3">試行回数</th>
              <th className="p-3">次回再送予定</th>
              <th className="p-3">最終エラー</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-neutral-100 align-top">
                <td className="p-3">{new Date(e.createdAt).toLocaleString("ja-JP")}</td>
                <td className="p-3">{e.eventType}</td>
                <td className="p-3">{e.destinationService}</td>
                <td className="p-3">
                  {e.aggregateType}:{e.aggregateId}
                </td>
                <td className="p-3">
                  <span className={STATUS_CLASS[e.status]}>{STATUS_LABEL[e.status]}</span>
                </td>
                <td className="p-3">{e.attemptCount}</td>
                <td className="p-3">{new Date(e.availableAt).toLocaleString("ja-JP")}</td>
                <td className="p-3 max-w-xs whitespace-pre-wrap text-red-600">
                  {e.lastErrorMessage ?? "-"}
                </td>
                <td className="p-3">
                  {e.status === "FAILED" && (
                    <button onClick={() => retry(e.id)} className="text-brand-600 underline">
                      手動再送
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-neutral-400">
                  キューにイベントはありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
