"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type AccountListItem } from "@/lib/api";

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch<AccountListItem[]>("/api/v1/admin/accounts?limit=200");
        setAccounts(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.push("/login");
      }
    })();
  }, [router]);

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-xl font-bold">アカウント一覧</h1>
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
                <td className="p-3">{a.accountCode}</td>
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
