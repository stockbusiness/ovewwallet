"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type AccountListItem } from "@/lib/api";

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
  const [reviewingAccounts, setReviewingAccounts] = useState<AccountListItem[]>([]);

  const loadReviewingAccounts = useCallback(async () => {
    try {
      const list = await apiFetch<AccountListItem[]>("/api/v1/admin/accounts?status=REVIEWING&limit=200");
      setReviewingAccounts(list);
    } catch {
      // ログイン切れ等はページ本体のAPI呼び出し側で処理されるため、ここでは静かに無視する
    }
  }, []);

  useEffect(() => {
    loadReviewingAccounts();
  }, [loadReviewingAccounts]);

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
      await loadReviewingAccounts();
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
          <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
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

        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-1 text-sm font-semibold text-amber-800">
            検証待ちアカウント (REVIEWING) — {reviewingAccounts.length}件
          </h2>
          <p className="mb-3 text-xs text-amber-700">
            残高不明のまま移行されたアカウント。検証者が旧システム側の記録などで残高を調査し、
            各アカウントの詳細画面から確認済み残高を入力して解消してください。
          </p>
          {reviewingAccounts.length === 0 ? (
            <p className="text-xs text-neutral-500">検証待ちのアカウントはありません</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pb-1">アカウントコード</th>
                  <th className="pb-1">メール</th>
                  <th className="pb-1">登録日</th>
                  <th className="pb-1"></th>
                </tr>
              </thead>
              <tbody>
                {reviewingAccounts.map((a) => (
                  <tr key={a.id} className="border-t border-amber-100">
                    <td className="py-1">{a.accountCode}</td>
                    <td className="py-1">{a.primaryEmail ?? "-"}</td>
                    <td className="py-1">{new Date(a.createdAt).toLocaleDateString("ja-JP")}</td>
                    <td className="py-1">
                      <Link href={`/accounts/${a.id}`} className="text-brand-600 underline">
                        検証する
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
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
