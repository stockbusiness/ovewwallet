"use client";

import { useState } from "react";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError } from "@/lib/api";

interface MigrationResult {
  batchId: string;
  totalCount: number;
  successCount: number;
  reviewingCount: number;
  errorCount: number;
  results: Array<{ row: number; oldUserId: string; status: string; message?: string }>;
}

export default function MigrationsPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [batchName, setBatchName] = useState("");
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setCsvContent(String(reader.result));
    reader.readAsText(file, "utf-8");
  }

  async function execute() {
    if (!csvContent || !fileName || !batchName) return;
    setError(null);
    try {
      const res = await apiFetch<MigrationResult>("/api/v1/admin/migrations/execute", {
        method: "POST",
        body: JSON.stringify({ fileName, csvContent, batchName }),
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
        <h1 className="mb-1 text-xl font-bold">既存ユーザー移行</h1>
        <p className="mb-4 text-xs text-neutral-500">
          形式: old_user_id,old_balance (old_balance を空欄にすると「残高不明」として扱われ、
          推定値を入れずアカウントは REVIEWING 状態になります)
        </p>

        <div className="mb-4 flex items-center gap-3">
          <label className="text-xs">
            バッチ名
            <input
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              className="ml-2 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              placeholder="2026年7月度移行"
            />
          </label>
          <input type="file" accept=".csv,text/csv" onChange={onFileChange} className="text-sm" />
          <button
            onClick={execute}
            disabled={!csvContent || !batchName}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            実行
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {result && (
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3 grid grid-cols-4 gap-3 text-center text-xs">
              <Stat label="総件数" value={result.totalCount} />
              <Stat label="正常件数" value={result.successCount} tone="text-emerald-600" />
              <Stat label="要確認 (残高不明)" value={result.reviewingCount} tone="text-amber-600" />
              <Stat label="エラー件数" value={result.errorCount} tone="text-red-600" />
            </div>
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pb-1">行</th>
                  <th className="pb-1">旧ユーザーID</th>
                  <th className="pb-1">結果</th>
                  <th className="pb-1">メッセージ</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.row} className="border-t border-neutral-100">
                    <td className="py-1">{r.row}</td>
                    <td className="py-1">{r.oldUserId}</td>
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
