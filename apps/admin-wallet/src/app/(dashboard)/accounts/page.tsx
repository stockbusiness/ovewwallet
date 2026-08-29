"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, API_BASE_URL, type AccountListItem } from "@/lib/api";

const STATUS_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "PENDING", label: "PENDING" },
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "RESTRICTED", label: "RESTRICTED" },
  { value: "REVIEWING", label: "REVIEWING" },
  { value: "LOCKED", label: "LOCKED" },
  { value: "CLOSED", label: "CLOSED (退会済み)" },
  { value: "MERGED", label: "MERGED" },
];

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const query = status ? `&status=${status}` : "";
        const list = await apiFetch<AccountListItem[]>(`/api/v1/admin/accounts?limit=200${query}`);
        setAccounts(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    })();
  }, [router, status]);

  async function downloadCsv() {
    setExporting(true);
    setError(null);
    try {
      const query = status ? `?status=${status}` : "";
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/accounts/export${query}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "accounts.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("CSVのダウンロードに失敗しました");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">アカウント一覧</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={downloadCsv}
              disabled={exporting}
              className="rounded-md border border-sengoku-border px-4 py-1.5 text-sm text-sengoku-text disabled:opacity-50"
            >
              {exporting ? "ダウンロード中..." : "CSVダウンロード"}
            </button>
            <Link href="/accounts/merge" className="text-sm text-sengoku-gold underline">
              アカウント統合
            </Link>
          </div>
        </div>
        <div className="mb-4 flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm text-sengoku-muted">
            状態で絞り込み:
          </label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-sengoku-border px-2 py-1 text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="mb-4 text-sm text-sengoku-red">{error}</p>}
        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">アカウントコード</th>
              <th className="p-3">状態</th>
              <th className="p-3">メール</th>
              <th className="p-3">ウォレット残高</th>
              <th className="p-3">登録日</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-sengoku-border">
                <td className="p-3">
                  <Link href={`/accounts/${a.id}`} className="text-sengoku-gold underline">
                    {a.accountCode}
                  </Link>
                </td>
                <td className="p-3">{a.status}</td>
                <td className="p-3">{a.primaryEmail ?? "-"}</td>
                <td className="p-3">
                  {a.wallet ? (
                    <Link href={`/wallets/${a.wallet.id}`} className="text-sengoku-gold underline">
                      {Number(a.wallet.availableBalance).toLocaleString("ja-JP")} ORI
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="p-3">{new Date(a.createdAt).toLocaleDateString("ja-JP")}</td>
              </tr>
            ))}
          </tbody>
        </table>
    </>
  );
}
