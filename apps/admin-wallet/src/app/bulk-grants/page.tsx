"use client";

import { useState } from "react";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError } from "@/lib/api";

interface BulkGrantResult {
  batchId: string;
  totalCount: number;
  successCount: number;
  duplicateCount: number;
  unknownUserCount: number;
  errorCount: number;
  totalAmountGranted: string;
  results: Array<{ row: number; externalUserId: string; status: string; message?: string }>;
}

export default function BulkGrantsPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [result, setResult] = useState<BulkGrantResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvContent(String(reader.result));
    reader.readAsText(file, "utf-8");
  }

  async function execute() {
    if (!csvContent || !fileName) return;
    setError(null);
    try {
      const res = await apiFetch<BulkGrantResult>("/api/v1/admin/bulk-grants", {
        method: "POST",
        body: JSON.stringify({ fileName, csvContent }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "実行に失敗しました");
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-1 text-xl font-bold">CSV一括付与</h1>
        <p className="mb-4 text-xs text-neutral-500">
          形式: external_user_id,amount,transaction_name,reason,event_id,idempotency_key
          (external_user_id は OVEアカウントコード。同じCSVを再実行しても二重付与されません)
        </p>

        <div className="mb-4 flex items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={onFileChange} className="text-sm" />
          <button
            onClick={execute}
            disabled={!csvContent}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            実行
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {result && (
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3 grid grid-cols-5 gap-3 text-center text-xs">
              <Stat label="総件数" value={result.totalCount} />
              <Stat label="正常件数" value={result.successCount} tone="text-emerald-600" />
              <Stat label="重複件数" value={result.duplicateCount} tone="text-amber-600" />
              <Stat label="ユーザー不明" value={result.unknownUserCount} tone="text-amber-600" />
              <Stat label="エラー件数" value={result.errorCount} tone="text-red-600" />
            </div>
            <p className="mb-3 text-sm">合計付与OVE: {Number(result.totalAmountGranted).toLocaleString("ja-JP")}</p>
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pb-1">行</th>
                  <th className="pb-1">対象</th>
                  <th className="pb-1">結果</th>
                  <th className="pb-1">メッセージ</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.row} className="border-t border-neutral-100">
                    <td className="py-1">{r.row}</td>
                    <td className="py-1">{r.externalUserId}</td>
                    <td className="py-1">{r.status}</td>
                    <td className="py-1">{r.message ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-neutral-100 p-2">
      <p className="text-neutral-500">{label}</p>
      <p className={`text-base font-bold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
