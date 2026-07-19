"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type AccountListItem } from "@/lib/api";

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

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">アカウント一覧</h1>
          <Link href="/accounts/merge" className="text-sm text-brand-600 underline">
            アカウント統合
          </Link>
        </div>
        <div className="mb-4 flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm text-neutral-600">
            状態で絞り込み:
          </label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
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
              <tr key={a.id} className="border-t border-neutral-100">
                <td className="p-3">
                  <Link href={`/accounts/${a.id}`} className="text-brand-600 underline">
                    {a.accountCode}
                  </Link>
                </td>
                <td className="p-3">{a.status}</td>
                <td className="p-3">{a.primaryEmail ?? "-"}</td>
                <td className="p-3">
                  {a.wallet ? (
                    <Link href={`/wallets/${a.wallet.id}`} className="text-brand-600 underline">
                      {Number(a.wallet.availableBalance).toLocaleString("ja-JP")} OVE
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
      </main>
    </div>
  );
}
