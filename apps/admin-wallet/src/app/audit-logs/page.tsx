"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, API_BASE_URL, type AuditLogItem } from "@/lib/api";

export default function AuditLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch<AuditLogItem[]>("/api/v1/admin/audit-logs?limit=200");
        setLogs(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    })();
  }, [router]);

  async function downloadCsv() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/audit-logs/export`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-logs.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("CSVのダウンロードに失敗しました");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">管理者操作ログ</h1>
          <button
            onClick={downloadCsv}
            disabled={exporting}
            className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm text-neutral-700 disabled:opacity-50"
          >
            {exporting ? "ダウンロード中..." : "CSVダウンロード"}
          </button>
        </div>
        <p className="mb-4 text-xs text-neutral-500">監査ログは削除できません (指示書16章)。</p>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">日時</th>
              <th className="p-3">実行者種別</th>
              <th className="p-3">操作</th>
              <th className="p-3">対象</th>
              <th className="p-3">結果</th>
              <th className="p-3">理由</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-neutral-100">
                <td className="p-3">{new Date(l.createdAt).toLocaleString("ja-JP")}</td>
                <td className="p-3">{l.actorType}</td>
                <td className="p-3">{l.actionType}</td>
                <td className="p-3">
                  {l.targetType}:{l.targetId}
                </td>
                <td className="p-3">
                  <span className={l.result === "SUCCESS" ? "text-emerald-600" : "text-red-600"}>{l.result}</span>
                </td>
                <td className="p-3">{l.reason ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
