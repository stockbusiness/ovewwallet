"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, type ServiceIntegrationItem } from "@/lib/api";

export default function ServiceIntegrationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<ServiceIntegrationItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<ServiceIntegrationItem[]>("/api/v1/admin/service-integrations");
      setItems(list);
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

  async function suspend(id: string) {
    const reason = window.prompt("緊急停止の理由を入力してください");
    if (!reason) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/service-integrations/${id}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "緊急停止に失敗しました");
    }
  }

  async function reactivate(id: string) {
    const reason = window.prompt("再開の理由を入力してください");
    if (!reason) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/service-integrations/${id}/reactivate`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "再開に失敗しました");
    }
  }

  return (
    <>
        <h1 className="mb-1 text-xl font-bold">外部サービス管理</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          緊急停止すると、当該サービスのAPIキーによる外部APIリクエストは即座に拒否されます。
        </p>
        {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}
        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">サービスコード</th>
              <th className="p-3">状態</th>
              <th className="p-3">1リクエスト上限</th>
              <th className="p-3">1日あたり上限</th>
              <th className="p-3">最終アクセス</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-sengoku-border">
                <td className="p-3">{s.serviceCode}</td>
                <td className="p-3">
                  <span className={s.status === "ACTIVE" ? "text-sengoku-green" : "font-semibold text-sengoku-red"}>
                    {s.status}
                  </span>
                </td>
                <td className="p-3">{Number(s.perRequestAmountLimit).toLocaleString("ja-JP")} OVE</td>
                <td className="p-3">{Number(s.dailyAmountLimit).toLocaleString("ja-JP")} OVE</td>
                <td className="p-3">{s.lastAccessedAt ? new Date(s.lastAccessedAt).toLocaleString("ja-JP") : "-"}</td>
                <td className="p-3">
                  {s.status === "ACTIVE" ? (
                    <button onClick={() => suspend(s.id)} className="text-xs text-sengoku-red underline">
                      緊急停止
                    </button>
                  ) : (
                    <button onClick={() => reactivate(s.id)} className="text-xs text-sengoku-gold underline">
                      再開
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>  );
}
