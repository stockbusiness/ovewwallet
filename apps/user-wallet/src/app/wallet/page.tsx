"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AppHeader,
  BalanceCard,
  ActionGrid,
  InfoCard,
  BottomNavigation,
  SectionHeader,
  TransactionItem,
  TRANSACTION_TYPE_LABEL,
  HomeIcon,
  ClockIcon,
  GiftIcon,
  CartIcon,
  BellIcon,
  LinkIcon,
  MenuIcon,
  ThemeToggle,
} from "@ove/shared-ui";
import {
  apiFetch,
  ApiError,
  type OveAccount,
  type TransactionSummary,
  type WalletBalance,
  type Notice,
  type WalletHoldItem,
} from "@/lib/api";

export default function WalletTopPage() {
  const router = useRouter();
  const [account, setAccount] = useState<OveAccount | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [holds, setHolds] = useState<WalletHoldItem[]>([]);
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
        return;
      }
      // お知らせ・保留内訳は補助的な情報のため、取得に失敗してもホーム画面自体は表示する
      // (デプロイのタイミング差でこのエンドポイントだけ未反映という事態が過去に
      // 実際に発生したため、致命的な扱いにしない)。
      try {
        setNotices(await apiFetch<Notice[]>("/api/v1/me/notices"));
      } catch {
        setNotices([]);
      }
      try {
        setHolds(await apiFetch<WalletHoldItem[]>("/api/v1/me/wallet/holds"));
      } catch {
        setHolds([]);
      }
    })();
  }, [router]);

  const unreadCount = useMemo(() => notices.filter((n) => !n.is_read).length, [notices]);

  if (error) return <p className="p-6 text-sm text-sengoku-gold-soft">{error}</p>;
  if (!account || !balance) return <p className="p-6 text-sm text-sengoku-muted">読み込み中...</p>;

  return (
    <main className="flex flex-col gap-6 pb-24">
      <AppHeader
        right={
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/wallet/notices"
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-sengoku-border text-sengoku-muted"
            >
              <BellIcon className="h-4 w-4" />
              {unreadCount > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-sengoku-red" />}
            </Link>
          </div>
        }
      />

      <div className="flex flex-col gap-6 px-4">
        <p className="-mt-4 text-xs text-sengoku-muted">{balance.wallet_code}</p>

        <BalanceCard
          amount={Number(balance.available_balance).toLocaleString("ja-JP")}
          stats={[
            { label: "保留中残高", value: `${Number(balance.held_balance).toLocaleString("ja-JP")} OVE` },
            { label: "回収予定残高", value: `${Number(balance.pending_balance).toLocaleString("ja-JP")} OVE` },
          ]}
        />

        {holds.length > 0 && (
          <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
            <h2 className="text-sm font-bold text-sengoku-text">保留中残高の内訳</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {holds.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 text-sengoku-muted">
                    {h.reason}
                    <span className="mt-0.5 block text-xs text-sengoku-faint">
                      {new Date(h.held_at).toLocaleDateString("ja-JP")}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold text-sengoku-gold">
                    {Number(h.amount).toLocaleString("ja-JP")} OVE
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ActionGrid
          items={[
            { icon: <GiftIcon className="h-6 w-6" />, label: "OVEを貯める", href: "/wallet/earn" },
            { icon: <CartIcon className="h-6 w-6" />, label: "OVEを使う", href: "/wallet/use" },
            { icon: <ClockIcon className="h-6 w-6" />, label: "取引履歴", href: "/wallet/transactions" },
            { icon: <LinkIcon className="h-6 w-6" />, label: "連携サービス", href: "/wallet/services" },
          ]}
        />

        {notices.length > 0 && (
          <InfoCard
            title="お知らせ"
            message={notices[0].title}
            date={new Date(notices[0].published_at).toLocaleDateString("ja-JP")}
            actionLabel="すべて見る"
            actionHref="/wallet/notices"
            important={notices[0].importance === "IMPORTANT"}
            unread={!notices[0].is_read}
          />
        )}

        <section>
          <SectionHeader title="最近の取引" actionLabel="すべて見る" actionHref="/wallet/transactions" />
          <ul className="divide-y divide-sengoku-border overflow-hidden rounded-xl border border-sengoku-border bg-sengoku-navy">
            {transactions.length === 0 && <li className="p-4 text-xs text-sengoku-faint">取引履歴はありません</li>}
            {transactions.map((t) => (
              <li key={t.id}>
                <TransactionItem
                  icon={t.direction === "CREDIT" ? <GiftIcon className="h-5 w-5" /> : <CartIcon className="h-5 w-5" />}
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
      </div>

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
