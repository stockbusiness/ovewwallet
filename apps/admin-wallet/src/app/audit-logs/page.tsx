"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type AuditLogItem } from "@/lib/api";

export default function AuditLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-xl font-bold">管理者操作ログ</h1>
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
