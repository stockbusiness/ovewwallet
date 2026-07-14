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
  const [preview, setPreview] = useState<BulkGrantResult | null>(null);
  const [result, setResult] = useState<BulkGrantResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setCsvContent(String(reader.result));
    reader.readAsText(file, "utf-8");
  }

  async function runPreview() {
    if (!csvContent || !fileName) return;
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch<BulkGrantResult>("/api/v1/admin/bulk-grants/preview", {
        method: "POST",
        body: JSON.stringify({ fileName, csvContent }),
      });
      setPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "プレビューに失敗しました");
    }
  }

  async function confirmExecute() {
    if (!csvContent || !fileName || !preview) return;
    setError(null);
    try {
      const res = await apiFetch<BulkGrantResult>("/api/v1/admin/bulk-grants/execute", {
        method: "POST",
        body: JSON.stringify({ fileName, csvContent, batchId: preview.batchId }),
      });
      setResult(res);
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "実行に失敗しました");
    }
  }

  const summary = result ?? preview;

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
            onClick={runPreview}
            disabled={!csvContent}
            className="rounded-md bg-neutral-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            プレビュー
          </button>
          {preview && !result && (
            <button
              onClick={confirmExecute}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
            >
              内容を確認して実行する
            </button>
          )}
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {summary && (
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="mb-3 text-xs font-semibold text-neutral-500">
              {result ? "実行結果" : "プレビュー (まだウォレットへは反映されていません)"}
            </p>
            <div className="mb-3 grid grid-cols-5 gap-3 text-center text-xs">
              <Stat label="総件数" value={summary.totalCount} />
              <Stat label="正常件数" value={summary.successCount} tone="text-emerald-600" />
              <Stat label="重複件数" value={summary.duplicateCount} tone="text-amber-600" />
              <Stat label="ユーザー不明" value={summary.unknownUserCount} tone="text-amber-600" />
              <Stat label="エラー件数" value={summary.errorCount} tone="text-red-600" />
            </div>
            <p className="mb-3 text-sm">
              合計付与予定OVE: {Number(summary.totalAmountGranted).toLocaleString("ja-JP")}
            </p>
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
                {summary.results.map((r) => (
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
