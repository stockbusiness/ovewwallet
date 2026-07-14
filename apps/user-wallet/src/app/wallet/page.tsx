"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, type OveAccount, type TransactionSummary, type WalletBalance } from "@/lib/api";

const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  REGISTRATION_BONUS: "登録特典",
  AIART_ATTENDANCE: "AIアート教室参加特典",
  ADMIN_GRANT: "管理者付与",
  ADMIN_DEDUCTION: "管理者減算",
  ITEM_EXCHANGE: "アイテム交換",
  REVERSAL: "取消",
  HOLD: "保留",
  RELEASE: "保留解除",
};

function formatAmount(amount: string, direction: "CREDIT" | "DEBIT"): string {
  const sign = direction === "CREDIT" ? "+" : "-";
  return `${sign}${Number(amount).toLocaleString("ja-JP")}`;
}

export default function WalletTopPage() {
  const router = useRouter();
  const [account, setAccount] = useState<OveAccount | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const acc = await apiFetch<OveAccount>("/api/v1/accounts/me");
        setAccount(acc);
        const [bal, txns] = await Promise.all([
          apiFetch<WalletBalance>(`/api/v1/wallets/${acc.id}/balance`),
          apiFetch<TransactionSummary[]>(`/api/v1/wallets/${acc.id}/transactions?limit=5`),
        ]);
        setBalance(bal);
        setTransactions(txns);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError("読み込みに失敗しました");
      }
    })();
  }, [router]);

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!account || !balance) return <p className="p-6 text-sm text-neutral-500">読み込み中...</p>;

  return (
    <main className="flex flex-col gap-6 p-6">
      <header>
        <p className="text-xs text-neutral-500">{balance.wallet_code}</p>
        <h1 className="text-lg font-bold text-brand-700">ウォレットトップ</h1>
      </header>

      <section className="rounded-xl bg-brand-600 p-5 text-white shadow">
        <p className="text-xs opacity-80">利用可能残高</p>
        <p className="mt-1 text-3xl font-bold">{Number(balance.available_balance).toLocaleString("ja-JP")} OVE</p>
        <div className="mt-4 flex justify-between text-xs opacity-90">
          <span>保留残高: {Number(balance.held_balance).toLocaleString("ja-JP")} OVE</span>
          <span>累計獲得: {Number(balance.lifetime_credited).toLocaleString("ja-JP")} OVE</span>
        </div>
        <p className="mt-1 text-xs opacity-90">累計利用: {Number(balance.lifetime_debited).toLocaleString("ja-JP")} OVE</p>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        現在のOVEは、OVEウォレット内で管理されるサービス内ポイントです。
        現時点ではブロックチェーン上の暗号資産ではありません。
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">最近の取引</h2>
          <Link href="/wallet/transactions" className="text-xs text-brand-600 underline">
            すべて見る
          </Link>
        </div>
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {transactions.length === 0 && <li className="p-3 text-xs text-neutral-400">取引履歴はありません</li>}
          {transactions.map((t) => (
            <li key={t.id} className="flex items-center justify-between p-3">
              <div>
                <p className="text-sm">{t.display_name || TRANSACTION_TYPE_LABEL[t.transaction_type] || t.transaction_type}</p>
                <p className="text-xs text-neutral-400">{new Date(t.occurred_at).toLocaleString("ja-JP")}</p>
              </div>
              <span className={t.direction === "CREDIT" ? "text-sm font-semibold text-brand-600" : "text-sm font-semibold text-neutral-600"}>
                {formatAmount(t.amount, t.direction)} OVE
              </span>
            </li>
          ))}
        </ul>
      </section>

      <nav className="grid grid-cols-2 gap-3 text-sm">
        <Link href="/about" className="rounded-md border border-neutral-200 p-3 text-center">
          OVEについて
        </Link>
        <button disabled className="rounded-md border border-neutral-200 p-3 text-center text-neutral-400">
          OVEを使う (準備中)
        </button>
      </nav>
    </main>
  );
}
