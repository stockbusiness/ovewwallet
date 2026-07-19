"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BottomNavigation,
  TransactionItem,
  TRANSACTION_TYPE_LABEL,
  ArrowLeftIcon,
  FilterIcon,
  HomeIcon,
  ClockIcon,
  GiftIcon,
  CartIcon,
  MenuIcon,
  ThemeToggle,
} from "@ove/shared-ui";
import { apiFetch, ApiError, type TransactionSummary } from "@/lib/api";

type FilterKey = "ALL" | "CREDIT" | "DEBIT" | "HELD";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "ALL", label: "すべて" },
  { key: "CREDIT", label: "獲得" },
  { key: "DEBIT", label: "利用" },
  { key: "HELD", label: "保留" },
];

function matchesFilter(t: TransactionSummary, filter: FilterKey): boolean {
  if (filter === "ALL") return true;
  if (filter === "HELD") return t.status === "HELD";
  if (filter === "CREDIT") return t.direction === "CREDIT" && t.status === "COMPLETED";
  return t.direction === "DEBIT" && t.status === "COMPLETED";
}

function monthGroupLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export default function TransactionHistoryPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("ALL");

  useEffect(() => {
    (async () => {
      try {
        const txns = await apiFetch<TransactionSummary[]>("/api/v1/me/transactions?limit=100");
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

  const filtered = useMemo(() => transactions.filter((t) => matchesFilter(t, filter)), [transactions, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, TransactionSummary[]>();
    for (const t of filtered) {
      const key = monthGroupLabel(t.occurred_at);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 font-heading text-lg font-bold text-sengoku-text">取引履歴</h1>
        <ThemeToggle className="h-8 w-8 border-none" />
        <span className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <FilterIcon className="h-5 w-5" />
        </span>
      </header>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                active ? "bg-sengoku-red text-white" : "text-sengoku-muted hover:text-sengoku-text"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading && <p className="text-sm text-sengoku-muted">読み込み中...</p>}

      {!loading && filtered.length === 0 && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-center text-xs text-sengoku-faint">
          該当する取引はありません
        </p>
      )}

      {groups.map(([month, items]) => (
        <section key={month}>
          <p className="mb-2 text-xs font-semibold text-sengoku-muted">{month}</p>
          <ul className="divide-y divide-sengoku-border overflow-hidden rounded-xl border border-sengoku-border bg-sengoku-navy">
            {items.map((t) => (
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
      ))}

      <BottomNavigation
        items={[
          { href: "/wallet", label: "ホーム", icon: <HomeIcon className="h-5 w-5" /> },
          { href: "/wallet/transactions", label: "履歴", icon: <ClockIcon className="h-5 w-5" />, matchPrefix: true },
          { href: "/wallet/earn", label: "貯める", icon: <GiftIcon className="h-5 w-5" /> },
          { href: "/wallet/use", label: "使う", icon: <CartIcon className="h-5 w-5" /> },
          { href: "/wallet/menu", label: "メニュー", icon: <MenuIcon className="h-5 w-5" /> },
        ]}
      />
    </main>
  );
}
