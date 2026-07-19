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
  RankBadge,
} from "@ove/shared-ui";
import {
  apiFetch,
  ApiError,
  type OveAccount,
  type TransactionSummary,
  type WalletBalance,
  type Notice,
  type WalletHoldItem,
  type DailyBonusStatus,
  type DailyBonusClaimResult,
  type ExpiringCreditsSummary,
} from "@/lib/api";

export default function WalletTopPage() {
  const router = useRouter();
  const [account, setAccount] = useState<OveAccount | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [holds, setHolds] = useState<WalletHoldItem[]>([]);
  const [dailyBonus, setDailyBonus] = useState<DailyBonusStatus | null>(null);
  const [expiringCredits, setExpiringCredits] = useState<ExpiringCreditsSummary | null>(null);
  const [claimingBonus, setClaimingBonus] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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
      // お知らせ・保留内訳・継続ログインボーナスは補助的な情報のため、取得に失敗しても
      // ホーム画面自体は表示する (デプロイのタイミング差でこのエンドポイントだけ
      // 未反映という事態が過去に実際に発生したため、致命的な扱いにしない)。
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
      try {
        setDailyBonus(await apiFetch<DailyBonusStatus>("/api/v1/me/daily-bonus/status"));
      } catch {
        setDailyBonus(null);
      }
      try {
        setExpiringCredits(await apiFetch<ExpiringCreditsSummary>("/api/v1/me/wallet/expiring-credits"));
      } catch {
        setExpiringCredits(null);
      }
    })();
  }, [router]);

  async function claimDailyBonus() {
    setClaimingBonus(true);
    try {
      const result = await apiFetch<DailyBonusClaimResult>("/api/v1/me/daily-bonus/claim", { method: "POST" });
      setDailyBonus({
        claimed_today: true,
        current_streak: result.current_streak,
        next_streak: result.current_streak,
        next_amount: result.amount,
      });
      setToast(`${result.amount} OVEを受け取りました (${result.current_streak}日連続)`);
      // 継続ログインボーナスもCREDITのため、階級表示(RankBadge)が参照する
      // lifetime_creditedも合わせて更新する (available_balanceだけ更新すると、
      // 再読み込みするまで階級表示が古い累計獲得量のまま止まって見える不具合になる)。
      setBalance((prev) =>
        prev
          ? {
              ...prev,
              available_balance: String(Number(prev.available_balance) + Number(result.amount)),
              lifetime_credited: String(Number(prev.lifetime_credited) + Number(result.amount)),
            }
          : prev,
      );
    } catch {
      setToast("受け取りに失敗しました");
    } finally {
      setClaimingBonus(false);
      window.setTimeout(() => setToast(null), 2000);
    }
  }

  const unreadCount = useMemo(() => notices.filter((n) => !n.is_read).length, [notices]);

  if (error) return <p className="p-6 text-sm text-sengoku-gold-soft">{error}</p>;
  if (!account || !balance) return <p className="p-6 text-sm text-sengoku-muted">読み込み中...</p>;

  return (
    <main className="relative flex flex-col gap-6 pb-24">
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-6">
          <div className="rounded-full bg-sengoku-ink px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/30">
            {toast}
          </div>
        </div>
      )}

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

        {expiringCredits && Number(expiringCredits.total_amount) > 0 && (
          <section className="rounded-xl border border-sengoku-gold/40 bg-sengoku-gold/10 p-4">
            <p className="text-sm font-bold text-sengoku-gold-soft">
              まもなく{Number(expiringCredits.total_amount).toLocaleString("ja-JP")} OVEが失効します
            </p>
            {expiringCredits.nearest_expires_at && (
              <p className="mt-0.5 text-xs text-sengoku-gold-soft">
                最短の失効日: {new Date(expiringCredits.nearest_expires_at).toLocaleDateString("ja-JP")}
                (今後{expiringCredits.within_days}日以内)
              </p>
            )}
          </section>
        )}

        <RankBadge lifetimeCredited={Number(balance.lifetime_credited)} />

        {dailyBonus && (
          <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-sengoku-text">継続ログインボーナス</h2>
                <p className="mt-0.5 text-xs text-sengoku-muted">
                  {dailyBonus.claimed_today
                    ? `本日は受け取り済み (${dailyBonus.current_streak}日連続)`
                    : `${dailyBonus.next_streak}日目・${Number(dailyBonus.next_amount).toLocaleString("ja-JP")} OVE`}
                </p>
              </div>
              <button
                type="button"
                onClick={claimDailyBonus}
                disabled={dailyBonus.claimed_today || claimingBonus}
                className="shrink-0 rounded-full bg-sengoku-red px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-sengoku-border disabled:text-sengoku-faint"
              >
                {dailyBonus.claimed_today ? "受取済み" : claimingBonus ? "受取中..." : "受け取る"}
              </button>
            </div>
            <Link href="/wallet/daily-bonus/history" className="mt-2 inline-block text-xs text-sengoku-gold-soft underline">
              受け取り履歴を見る
            </Link>
          </section>
        )}

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
