"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
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

        <HelpPanel storageKey="service-integrations" title="このページについて・使い方">
          <p>
            ORIウォレットへAPI経由でアクセスしている外部サービス(代理店システム等)の一覧と、
            緊急停止・再開を行う画面です。新しい外部サービスをここから追加することはできません(追加はエンジニアの作業が必要です)。
          </p>
          <div>
            <p className="font-semibold text-sengoku-text">いつ使うか</p>
            <p>
              ある外部サービスのAPIキーが漏えいした疑いがある、または想定外の大量アクセス・不審な動作があるなど、
              「今すぐそのサービスからのアクセスを止めたい」ときに使います。
            </p>
          </div>
          <div>
            <p className="font-semibold text-sengoku-text">操作手順</p>
            <ol className="ml-4 list-decimal">
              <li>止めたいサービスコードの行にある「緊急停止」を押す</li>
              <li>理由を入力(必須。後から誰が何のために止めたか監査ログに残ります)</li>
              <li>状態が即座に反映され、それ以降そのサービスからのAPIリクエストは全て拒否されます(遅延なし)</li>
              <li>問題が解決したら、同じ行の「再開」を押して理由を入力すると即座に復旧します</li>
            </ol>
          </div>
          <p className="text-sengoku-gold-soft">
            注意: サービスコードを間違えて停止すると、そのサービスの本番トラフィックが即座に止まります。停止前に対象のサービスコードをよく確認してください。
          </p>
        </HelpPanel>

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
                <td className="p-3">{Number(s.perRequestAmountLimit).toLocaleString("ja-JP")} ORI</td>
                <td className="p-3">{Number(s.dailyAmountLimit).toLocaleString("ja-JP")} ORI</td>
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
