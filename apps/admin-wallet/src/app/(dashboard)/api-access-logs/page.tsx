"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, type ApiAccessLogItem } from "@/lib/api";

export default function ApiAccessLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<ApiAccessLogItem[]>([]);
  const [statusCode, setStatusCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const query = statusCode ? `&statusCode=${statusCode}` : "";
        const list = await apiFetch<ApiAccessLogItem[]>(`/api/v1/admin/api-access-logs?limit=200${query}`);
        setLogs(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    })();
  }, [router, statusCode]);

  return (
    <>
        <h1 className="mb-4 text-xl font-bold">APIアクセスログ</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          外部サービスAPI (指示書11章) へのリクエスト履歴。認証失敗も含めて記録される。
        </p>
        {error && <p className="mb-4 text-sm text-sengoku-red">{error}</p>}
        <div className="mb-4 flex items-center gap-2 text-sm">
          <label htmlFor="statusCode">ステータスコード:</label>
          <input
            id="statusCode"
            className="rounded border border-sengoku-border px-2 py-1"
            placeholder="例: 401"
            value={statusCode}
            onChange={(e) => setStatusCode(e.target.value)}
          />
        </div>
        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">日時</th>
              <th className="p-3">サービス</th>
              <th className="p-3">APIキー</th>
              <th className="p-3">メソッド</th>
              <th className="p-3">パス</th>
              <th className="p-3">ステータス</th>
              <th className="p-3">送信元IP</th>
              <th className="p-3">エラー</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-sengoku-border">
                <td className="p-3">{new Date(l.createdAt).toLocaleString("ja-JP")}</td>
                <td className="p-3">{l.serviceCode ?? "-"}</td>
                <td className="p-3">{l.apiKeyPrefix ? `${l.apiKeyPrefix}...` : "-"}</td>
                <td className="p-3">{l.method}</td>
                <td className="p-3">{l.path}</td>
                <td className="p-3">
                  <span className={l.statusCode < 400 ? "text-sengoku-green" : "text-sengoku-red"}>{l.statusCode}</span>
                </td>
                <td className="p-3">{l.sourceIp ?? "-"}</td>
                <td className="p-3">{l.errorMessage ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>  );
}
