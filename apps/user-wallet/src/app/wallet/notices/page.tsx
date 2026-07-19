"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNavigation, ArrowLeftIcon, HomeIcon, ClockIcon, GiftIcon, CartIcon, MenuIcon } from "@ove/shared-ui";
import { apiFetch, ApiError, type Notice } from "@/lib/api";

export default function NoticesPage() {
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch<Notice[]>("/api/v1/me/notices");
        setNotices(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    })();
  }, [router]);

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">お知らせ</h1>
      </header>

      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}
      {!error && notices === null && <p className="text-sm text-sengoku-muted">読み込み中...</p>}
      {notices?.length === 0 && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-center text-xs text-sengoku-faint">
          お知らせはありません
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {notices?.map((n) => (
          <li key={n.id} className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
            <p className="text-sm font-semibold text-sengoku-text">{n.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-sengoku-muted">{n.message}</p>
            <p className="mt-2 text-xs text-sengoku-faint">{new Date(n.published_at).toLocaleDateString("ja-JP")}</p>
          </li>
        ))}
      </ul>

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
