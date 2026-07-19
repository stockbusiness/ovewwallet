"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, BottomNavigation, HomeIcon, ClockIcon, GiftIcon, CartIcon, MenuIcon } from "@ove/shared-ui";
import { apiFetch, ApiError, type DailyBonusHistoryItem } from "@/lib/api";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function DailyBonusHistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState<DailyBonusHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        setHistory(await apiFetch<DailyBonusHistoryItem[]>("/api/v1/me/daily-bonus/history"));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    })();
  }, [router]);

  const claimedByDate = useMemo(() => {
    const map = new Map<string, DailyBonusHistoryItem>();
    for (const item of history ?? []) map.set(item.claimed_date, item);
    return map;
  }, [history]);

  const today = new Date();
  const viewDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const claimsThisMonth = Array.from(claimedByDate.keys()).filter((d) => d.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)).length;

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">継続ログインボーナス履歴</h1>
      </header>

      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}
      {!error && history === null && <p className="text-sm text-sengoku-muted">読み込み中...</p>}

      {history !== null && (
        <div className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonthOffset((o) => o - 1)}
              disabled={monthOffset <= -2}
              className="rounded-full px-3 py-1 text-xs text-sengoku-muted disabled:opacity-30"
            >
              前月
            </button>
            <p className="text-sm font-bold text-sengoku-text">
              {year}年{month + 1}月 (受け取り{claimsThisMonth}日)
            </p>
            <button
              type="button"
              onClick={() => setMonthOffset((o) => o + 1)}
              disabled={monthOffset >= 0}
              className="rounded-full px-3 py-1 text-xs text-sengoku-muted disabled:opacity-30"
            >
              翌月
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-sengoku-faint">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="pb-1">
                {w}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} />;
              const key = toDateKey(year, month, day);
              const claim = claimedByDate.get(key);
              return (
                <div
                  key={key}
                  title={claim ? `${claim.streak_count}日連続・${claim.amount} OVE` : undefined}
                  className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${
                    claim ? "bg-sengoku-gold/20 font-bold text-sengoku-gold" : "text-sengoku-faint"
                  }`}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
