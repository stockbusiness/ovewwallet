"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, type WalletListItem } from "@/lib/api";
import { toDisplayCode } from "@ove/shared-ui";

export default function WalletsPage() {
  const router = useRouter();
  const [wallets, setWallets] = useState<WalletListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch<WalletListItem[]>("/api/v1/admin/wallets?limit=200");
        setWallets(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    })();
  }, [router]);

  return (
    <>
        <h1 className="mb-4 text-xl font-bold">ウォレット一覧</h1>
        {error && <p className="mb-4 text-sm text-sengoku-red">{error}</p>}
        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
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
              <tr key={w.id} className="border-t border-sengoku-border">
                <td className="p-3">{toDisplayCode(w.walletCode)}</td>
                <td className="p-3">{w.status}</td>
                <td className="p-3">{Number(w.availableBalance).toLocaleString("ja-JP")} ORI</td>
                <td className="p-3">{Number(w.heldBalance).toLocaleString("ja-JP")} ORI</td>
                <td className="p-3">
                  <Link href={`/wallets/${w.id}`} className="text-sengoku-gold underline">
                    詳細
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>  );
}
