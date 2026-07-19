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
  const [importantOnly, setImportantOnly] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch<Notice[]>("/api/v1/me/notices");
        setNotices(list);

        // 一覧を開いた時点で未読分をまとめて既読にする (メール受信箱等でよくある挙動)。
        // 失敗しても一覧表示自体は継続する (既読化は補助的な機能のため)。
        const unread = list.filter((n) => !n.is_read);
        await Promise.all(
          unread.map((n) => apiFetch(`/api/v1/me/notices/${n.id}/read`, { method: "POST" }).catch(() => undefined)),
        );
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

      {notices !== null && notices.length > 0 && (
        <div className="flex gap-2">
          {([false, true] as const).map((value) => {
            const active = importantOnly === value;
            return (
              <button
                key={String(value)}
                type="button"
                onClick={() => setImportantOnly(value)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  active ? "bg-sengoku-red text-white" : "text-sengoku-muted hover:text-sengoku-text"
                }`}
              >
                {value ? "重要のみ" : "すべて"}
              </button>
            );
          })}
        </div>
      )}

      {notices?.length === 0 && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-center text-xs text-sengoku-faint">
          お知らせはありません
        </p>
      )}

      {notices !== null && notices.length > 0 && importantOnly && notices.every((n) => n.importance !== "IMPORTANT") && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-center text-xs text-sengoku-faint">
          重要なお知らせはありません
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {notices?.filter((n) => !importantOnly || n.importance === "IMPORTANT").map((n) => (
          <li
            key={n.id}
            className={`rounded-xl border bg-sengoku-navy p-4 ${n.importance === "IMPORTANT" ? "border-sengoku-red" : "border-sengoku-border"}`}
          >
            <p className="flex items-center gap-1.5 text-sm font-semibold text-sengoku-text">
              {!n.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sengoku-red" aria-hidden />}
              {n.importance === "IMPORTANT" && <span className="text-xs font-bold text-sengoku-red">【重要】</span>}
              {n.title}
            </p>
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
