"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, type OveAccount, type TransactionSummary } from "@/lib/api";

function formatAmount(amount: string, direction: "CREDIT" | "DEBIT"): string {
  const sign = direction === "CREDIT" ? "+" : "-";
  return `${sign}${Number(amount).toLocaleString("ja-JP")}`;
}

export default function TransactionHistoryPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const acc = await apiFetch<OveAccount>("/api/v1/accounts/me");
        const txns = await apiFetch<TransactionSummary[]>(`/api/v1/wallets/${acc.id}/transactions?limit=100`);
        setTransactions(txns);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  return (
    <main className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <Link href="/wallet" className="text-sm text-brand-600">
          ← ウォレットトップ
        </Link>
      </div>
      <h1 className="text-lg font-bold text-brand-700">OVE履歴一覧</h1>

      {loading && <p className="text-sm text-neutral-500">読み込み中...</p>}

      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {!loading && transactions.length === 0 && (
          <li className="p-3 text-xs text-neutral-400">取引履歴はありません</li>
        )}
        {transactions.map((t) => (
          <li key={t.id} className="p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm">{t.display_name}</p>
              <span className={t.direction === "CREDIT" ? "text-sm font-semibold text-brand-600" : "text-sm font-semibold text-neutral-600"}>
                {formatAmount(t.amount, t.direction)} OVE
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              {t.transaction_code} ・ {t.status} ・ {new Date(t.occurred_at).toLocaleString("ja-JP")}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
