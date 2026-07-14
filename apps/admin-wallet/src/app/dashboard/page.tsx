"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type AdminMe, type ReconciliationResult, type WalletListItem } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [wallets, setWallets] = useState<WalletListItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, recRes, walletsRes] = await Promise.all([
          apiFetch<AdminMe>("/api/v1/admin/me"),
          apiFetch<ReconciliationResult>("/api/v1/admin/reconciliation"),
          apiFetch<WalletListItem[]>("/api/v1/admin/wallets?limit=200"),
        ]);
        setMe(meRes);
        setReconciliation(recRes);
        setWallets(walletsRes);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.push("/login");
      }
    })();
  }, [router]);

  if (!me) return <p className="p-6 text-sm text-neutral-500">読み込み中...</p>;

  const totalLifetimeCredited = wallets.reduce((sum, w) => sum + Number(w.lifetimeCredited), 0);
  const totalLifetimeDebited = wallets.reduce((sum, w) => sum + Number(w.lifetimeDebited), 0);
  const totalAvailable = wallets.reduce((sum, w) => sum + Number(w.availableBalance), 0);

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-xl font-bold">OVEダッシュボード</h1>
        <p className="mb-6 text-sm text-neutral-500">ログイン中: {me.displayName} ({me.role})</p>

        <div className="mb-6 grid grid-cols-4 gap-4">
          <StatCard label="ウォレット数" value={wallets.length.toLocaleString("ja-JP")} />
          <StatCard label="発行済み残高合計" value={`${totalAvailable.toLocaleString("ja-JP")} OVE`} />
          <StatCard label="累計付与合計" value={`${totalLifetimeCredited.toLocaleString("ja-JP")} OVE`} />
          <StatCard label="累計利用合計" value={`${totalLifetimeDebited.toLocaleString("ja-JP")} OVE`} />
        </div>

        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">残高整合性チェック (指示書17章)</h2>
          {reconciliation && (
            <>
              <p className="mb-2 text-sm">
                検査対象: {reconciliation.checkedWalletCount}件 / 不一致:{" "}
                <span className={reconciliation.mismatchedWalletCount > 0 ? "font-bold text-red-600" : "text-emerald-600"}>
                  {reconciliation.mismatchedWalletCount}件
                </span>
              </p>
              {reconciliation.mismatched.length > 0 && (
                <table className="mt-2 w-full text-left text-xs">
                  <thead className="text-neutral-500">
                    <tr>
                      <th className="pb-1">ウォレット</th>
                      <th className="pb-1">台帳計算残高</th>
                      <th className="pb-1">キャッシュ残高</th>
                      <th className="pb-1">差額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.mismatched.map((m) => (
                      <tr key={m.walletId} className="border-t border-neutral-100">
                        <td className="py-1">{m.walletCode}</td>
                        <td className="py-1">{m.computedBalance}</td>
                        <td className="py-1">{m.cachedBalance}</td>
                        <td className="py-1 font-semibold text-red-600">{m.difference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-brand-700">{value}</p>
    </div>
  );
}
