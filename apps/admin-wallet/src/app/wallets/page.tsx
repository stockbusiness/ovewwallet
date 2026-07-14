"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type WalletListItem } from "@/lib/api";

export default function WalletsPage() {
  const router = useRouter();
  const [wallets, setWallets] = useState<WalletListItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch<WalletListItem[]>("/api/v1/admin/wallets?limit=200");
        setWallets(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.push("/login");
      }
    })();
  }, [router]);

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-xl font-bold">ウォレット一覧</h1>
        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">ウォレットコード</th>
              <th className="p-3">状態</th>
              <th className="p-3">利用可能残高</th>
              <th className="p-3">保留残高</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {wallets.map((w) => (
              <tr key={w.id} className="border-t border-neutral-100">
                <td className="p-3">{w.walletCode}</td>
                <td className="p-3">{w.status}</td>
                <td className="p-3">{Number(w.availableBalance).toLocaleString("ja-JP")} OVE</td>
                <td className="p-3">{Number(w.heldBalance).toLocaleString("ja-JP")} OVE</td>
                <td className="p-3">
                  <Link href={`/wallets/${w.id}`} className="text-brand-600 underline">
                    詳細
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
