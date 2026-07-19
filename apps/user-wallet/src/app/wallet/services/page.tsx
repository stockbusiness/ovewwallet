"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNavigation, StatusBadge, LinkIcon, ArrowLeftIcon, HomeIcon, ClockIcon, GiftIcon, CartIcon, MenuIcon } from "@ove/shared-ui";
import { apiFetch, ApiError, type LinkedService } from "@/lib/api";

export default function LinkedServicesPage() {
  const router = useRouter();
  const [services, setServices] = useState<LinkedService[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch<LinkedService[]>("/api/v1/me/linked-services");
        setServices(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.push("/login");
      }
    })();
  }, [router]);

  function showComingSoon(label: string) {
    setToast(`${label}は準備中です`);
    window.setTimeout(() => setToast(null), 1800);
  }

  return (
    <main className="relative flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">連携サービス</h1>
      </header>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-6">
          <div className="rounded-full bg-sengoku-ink px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/30">
            {toast}
          </div>
        </div>
      )}

      <p className="text-xs leading-relaxed text-sengoku-muted">
        OVEウォレットと連携しているサービス一覧です。連携すると、各サービスでのOVE獲得・利用が同じウォレットに反映されます。
      </p>

      {services === null && <p className="text-sm text-sengoku-muted">読み込み中...</p>}
      {services?.length === 0 && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-center text-xs text-sengoku-faint">
          連携可能なサービスはまだありません
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {services?.map((s) => (
          <li key={s.service_code}>
            <button
              type="button"
              onClick={() => showComingSoon(s.service_name)}
              className="flex w-full items-center gap-3 rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-left transition-colors active:bg-sengoku-text/5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sengoku-gold/10 text-sengoku-gold">
                <LinkIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-sengoku-text">{s.service_name}</p>
                {s.linked && s.linked_at && (
                  <p className="mt-0.5 text-xs text-sengoku-muted">{new Date(s.linked_at).toLocaleDateString("ja-JP")}に連携</p>
                )}
              </span>
              <StatusBadge label={s.linked ? "連携済み" : "未連携"} tone={s.linked ? "credit" : "neutral"} />
            </button>
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
