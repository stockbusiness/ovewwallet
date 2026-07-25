"use client";

import {
  BottomNavigation,
  ThemeToggle,
  ArrowLeftIcon,
  HomeIcon,
  ClockIcon,
  GiftIcon,
  CartIcon,
  MenuIcon,
} from "@ove/shared-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CollectibleCardImage } from "@/components/CollectibleCardImage";
import { apiFetch, ApiError, type CollectibleHoldingSummary } from "@/lib/api";
import { collectibleStatusLabel } from "@/lib/collectible-status";

const PAGE_SIZE = 20;

export default function CollectionListPage() {
  const router = useRouter();
  const [items, setItems] = useState<CollectibleHoldingSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { reset: boolean; cursor?: string | null }) => {
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (includeRevoked) params.set("include_revoked", "true");
        if (opts.cursor) params.set("cursor", opts.cursor);
        const res = await apiFetch<{ items: CollectibleHoldingSummary[]; next_cursor: string | null }>(
          `/api/v1/me/collectibles?${params.toString()}`,
        );
        setItems((prev) => (opts.reset ? res.items : [...prev, ...res.items]));
        setNextCursor(res.next_cursor);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 503) {
          setError("現在ご利用いただけません");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    },
    [includeRevoked, router],
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    load({ reset: true }).finally(() => setLoading(false));
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    await load({ reset: false, cursor: nextCursor });
    setLoadingMore(false);
  }

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet/menu" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 font-heading text-lg font-bold text-sengoku-text">コレクション</h1>
        <ThemeToggle className="h-8 w-8 border-none" />
      </header>

      <button
        type="button"
        onClick={() => setIncludeRevoked((v) => !v)}
        className={`self-start rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
          includeRevoked ? "bg-sengoku-red text-white" : "border border-sengoku-border text-sengoku-muted"
        }`}
      >
        取消済みも表示
      </button>

      {loading && <p className="text-sm text-sengoku-muted">読み込み中...</p>}
      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-center text-xs text-sengoku-faint">
          まだカードを保有していません
        </p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => {
            const label = collectibleStatusLabel(item.status);
            return (
              <Link
                key={item.holding_id}
                href={`/wallet/collection/${item.holding_id}`}
                className="overflow-hidden rounded-xl border border-sengoku-border bg-sengoku-navy"
              >
                <div className="relative aspect-square w-full">
                  <CollectibleCardImage src={item.asset.thumbnail_url ?? item.asset.image_url} alt={item.asset.name} />
                </div>
                <div className="p-2">
                  <p className="truncate text-sm font-semibold text-sengoku-text">{item.asset.name}</p>
                  {item.serial_number && <p className="mt-0.5 text-[10px] text-sengoku-faint">#{item.serial_number}</p>}
                  <p className="mt-1 text-[10px] text-sengoku-muted">{label.primary}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="rounded-xl border border-sengoku-border py-2 text-sm font-semibold text-sengoku-muted disabled:opacity-50"
        >
          {loadingMore ? "読み込み中..." : "もっと見る"}
        </button>
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
