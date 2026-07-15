"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BalanceCard,
  BottomNavigation,
  SectionHeader,
  ServiceLinkCard,
  TransactionItem,
  TRANSACTION_TYPE_LABEL,
  HomeIcon,
  ClockIcon,
  GiftIcon,
  CartIcon,
  BellIcon,
  ShieldCoinIcon,
} from "@ove/shared-ui";
import { apiFetch, ApiError, type OveAccount, type TransactionSummary, type WalletBalance } from "@/lib/api";

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
          apiFetch<WalletBalance>("/api/v1/me/wallet"),
          apiFetch<TransactionSummary[]>("/api/v1/me/transactions?limit=5"),
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

  if (error) return <p className="p-6 text-sm text-sengoku-gold-soft">{error}</p>;
  if (!account || !balance) return <p className="p-6 text-sm text-sengoku-muted">読み込み中...</p>;

  return (
    <main className="flex flex-col gap-6 px-4 pb-24 pt-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-heading text-lg font-bold text-white">戦国ウォレット</p>
          <p className="text-xs text-sengoku-muted">{balance.wallet_code}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-sengoku-border text-sengoku-muted">
          <BellIcon className="h-4 w-4" />
        </span>
      </header>

      <BalanceCard
        amount={Number(balance.available_balance).toLocaleString("ja-JP")}
        stats={[
          { label: "保留中残高", value: `${Number(balance.held_balance).toLocaleString("ja-JP")} OVE` },
          { label: "回収予定残高", value: `${Number(balance.pending_balance).toLocaleString("ja-JP")} OVE` },
        ]}
      />

      <section className="rounded-lg border border-sengoku-border bg-sengoku-navy/50 p-3 text-xs leading-relaxed text-sengoku-muted">
        現在のOVEは、OVEウォレット内で管理されるサービス内ポイントです。
        現時点ではブロックチェーン上の暗号資産ではありません。
      </section>

      <section className="grid grid-cols-4 gap-3">
        <ServiceLinkCard icon={<GiftIcon className="h-5 w-5" />} label="OVEを貯める" disabled />
        <ServiceLinkCard icon={<CartIcon className="h-5 w-5" />} label="OVEを使う" disabled />
        <ServiceLinkCard icon={<ClockIcon className="h-5 w-5" />} label="取引履歴" href="/wallet/transactions" />
        <ServiceLinkCard icon={<ShieldCoinIcon className="h-5 w-5" />} label="OVEについて" href="/about" />
      </section>

      <section>
        <SectionHeader title="最近の取引" actionLabel="すべて見る" actionHref="/wallet/transactions" />
        <ul className="divide-y divide-sengoku-border overflow-hidden rounded-xl border border-sengoku-border bg-sengoku-navy">
          {transactions.length === 0 && <li className="p-4 text-xs text-sengoku-faint">取引履歴はありません</li>}
          {transactions.map((t) => (
            <li key={t.id}>
              <TransactionItem
                icon={
                  t.direction === "CREDIT" ? <GiftIcon className="h-5 w-5" /> : <CartIcon className="h-5 w-5" />
                }
                title={t.display_name || TRANSACTION_TYPE_LABEL[t.transaction_type] || t.transaction_type}
                subtitle={new Date(t.occurred_at).toLocaleString("ja-JP")}
                amount={t.amount}
                direction={t.direction}
                href={`/wallet/transactions/${t.id}`}
              />
            </li>
          ))}
        </ul>
      </section>

      <BottomNavigation
        items={[
          { href: "/wallet", label: "ホーム", icon: <HomeIcon className="h-5 w-5" /> },
          { href: "/wallet/transactions", label: "履歴", icon: <ClockIcon className="h-5 w-5" />, matchPrefix: true },
          { href: "/wallet/save", label: "貯める", icon: <GiftIcon className="h-5 w-5" />, disabled: true },
          { href: "/wallet/use", label: "使う", icon: <CartIcon className="h-5 w-5" />, disabled: true },
        ]}
      />
    </main>
  );
}
