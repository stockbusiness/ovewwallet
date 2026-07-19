"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { TransactionItem, GiftIcon, CartIcon, StatusBadge, ThemeToggle } from "@ove/shared-ui";
import {
  apiFetch,
  ApiError,
  type AdminMe,
  type DashboardStats,
  type ReconciliationResult,
  type WalletListItem,
  type TransactionItem as TransactionItemType,
  type RankDistributionItem,
} from "@/lib/api";
import { TrendChart } from "./TrendChart";
import { RankDistribution } from "./RankDistribution";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [wallets, setWallets] = useState<WalletListItem[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<TransactionItemType[]>([]);
  const [rankDistribution, setRankDistribution] = useState<RankDistributionItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, recRes, walletsRes, statsRes, txnsRes, rankRes] = await Promise.all([
          apiFetch<AdminMe>("/api/v1/admin/me"),
          apiFetch<ReconciliationResult>("/api/v1/admin/reconciliation"),
          apiFetch<WalletListItem[]>("/api/v1/admin/wallets?limit=200"),
          apiFetch<DashboardStats>("/api/v1/admin/dashboard-stats"),
          apiFetch<TransactionItemType[]>("/api/v1/admin/transactions?limit=8"),
          apiFetch<RankDistributionItem[]>("/api/v1/admin/dashboard-stats/rank-distribution"),
        ]);
        setMe(meRes);
        setReconciliation(recRes);
        setWallets(walletsRes);
        setStats(statsRes);
        setRecentTransactions(txnsRes);
        setRankDistribution(rankRes);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    })();
  }, [router]);

  if (error) return <p className="p-6 text-sm text-sengoku-red">{error}</p>;
  if (!me || !stats) return <p className="p-6 text-sm text-neutral-500">読み込み中...</p>;

  const totalAvailable = wallets.reduce((sum, w) => sum + Number(w.availableBalance), 0);
  const dayOverDayChange = (todayKey: "credited" | "debited", todayValue: number): number | null => {
    if (stats.dailyTrend.length < 2) return null;
    const yesterday = Number(stats.dailyTrend[stats.dailyTrend.length - 2][todayKey]);
    if (yesterday === 0) return null;
    return ((todayValue - yesterday) / yesterday) * 100;
  };
  const todayCredited = Number(stats.todayCredited);
  const todayDebited = Number(stats.todayDebited);
  const creditedDelta = dayOverDayChange("credited", todayCredited);
  const debitedDelta = dayOverDayChange("debited", todayDebited);

  return (
    <div>
      <AdminNav />
      <div className="min-h-[calc(100vh-57px)] w-full bg-sengoku-bg px-6 py-8">
        <main className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="font-heading text-xl font-bold text-sengoku-text">千の国ウォレット ダッシュボード</h1>
              <p className="mt-1 text-sm text-sengoku-muted">
                ログイン中: {me.displayName} ({me.role})
              </p>
            </div>
            <ThemeToggle />
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="発行済OVE合計" value={`${totalAvailable.toLocaleString("ja-JP")} OVE`} />
            <StatTile label="総アカウント数" value={stats.totalAccounts.toLocaleString("ja-JP")} />
            <StatTile label="本日付与OVE" value={`${todayCredited.toLocaleString("ja-JP")} OVE`} delta={creditedDelta} />
            <StatTile label="本日利用OVE" value={`${todayDebited.toLocaleString("ja-JP")} OVE`} delta={debitedDelta} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-5 lg:col-span-2">
              <h2 className="mb-4 text-sm font-bold text-sengoku-text">OVE発行・利用推移 (過去30日)</h2>
              <TrendChart data={stats.dailyTrend} />
            </section>

            <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-5">
              <h2 className="mb-3 text-sm font-bold text-sengoku-text">最近の取引</h2>
              {recentTransactions.length === 0 ? (
                <p className="text-xs text-sengoku-faint">取引はありません</p>
              ) : (
                <ul className="divide-y divide-sengoku-border">
                  {recentTransactions.map((t) => (
                    <li key={t.id}>
                      <TransactionItem
                        icon={
                          t.direction === "CREDIT" ? (
                            <GiftIcon className="h-4 w-4" />
                          ) : (
                            <CartIcon className="h-4 w-4" />
                          )
                        }
                        title={t.display_name}
                        subtitle={t.account_code}
                        amount={t.amount}
                        direction={t.direction}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="mb-6 rounded-xl border border-sengoku-border bg-sengoku-navy p-5">
            <h2 className="mb-4 text-sm font-bold text-sengoku-text">会員ランク分布</h2>
            <RankDistribution data={rankDistribution} />
          </section>

          <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-sengoku-text">残高整合性チェック (指示書17章)</h2>
              <StatusBadge
                label={reconciliation && reconciliation.mismatchedWalletCount > 0 ? "要確認" : "正常"}
                tone={reconciliation && reconciliation.mismatchedWalletCount > 0 ? "danger" : "success"}
              />
            </div>
            {reconciliation && (
              <>
                <p className="mb-2 text-sm text-sengoku-muted">
                  検査対象: {reconciliation.checkedWalletCount}件 / 不一致:{" "}
                  <span className={reconciliation.mismatchedWalletCount > 0 ? "font-bold text-sengoku-red" : "text-sengoku-text"}>
                    {reconciliation.mismatchedWalletCount}件
                  </span>
                </p>
                {reconciliation.mismatched.length > 0 && (
                  <table className="mt-2 w-full text-left text-xs">
                    <thead className="text-sengoku-faint">
                      <tr>
                        <th className="pb-1">ウォレット</th>
                        <th className="pb-1">台帳計算残高</th>
                        <th className="pb-1">キャッシュ残高</th>
                        <th className="pb-1">差額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.mismatched.map((m) => (
                        <tr key={m.walletId} className="border-t border-sengoku-border">
                          <td className="py-1.5 text-sengoku-text">{m.walletCode}</td>
                          <td className="py-1.5 text-sengoku-muted">{m.computedBalance}</td>
                          <td className="py-1.5 text-sengoku-muted">{m.cachedBalance}</td>
                          <td className="py-1.5 font-semibold text-sengoku-red">{m.difference}</td>
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
    </div>
  );
}

function StatTile({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <div className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
      <p className="text-xs text-sengoku-muted">{label}</p>
      <p className="mt-1.5 text-xl font-bold text-sengoku-gold">{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={`mt-1 text-xs font-semibold ${delta >= 0 ? "text-sengoku-gold-soft" : "text-sengoku-red"}`}>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}% (前日比)
        </p>
      )}
    </div>
  );
}
