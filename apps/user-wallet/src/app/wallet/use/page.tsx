"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNavigation, CartIcon, ArrowLeftIcon, HomeIcon, ClockIcon, GiftIcon, MenuIcon } from "@ove/shared-ui";
import { apiFetch, ApiError, type LinkedService, type MeFeatureFlags, type WalletBalance } from "@/lib/api";

export default function UseOvePage() {
  const router = useRouter();
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [services, setServices] = useState<LinkedService[] | null>(null);
  const [linkedServicesEnabled, setLinkedServicesEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [bal, list] = await Promise.all([
          apiFetch<WalletBalance>("/api/v1/me/wallet"),
          apiFetch<LinkedService[]>("/api/v1/me/linked-services"),
        ]);
        setBalance(bal);
        setServices(list.filter((s) => s.linked));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
        return;
      }
      // 空状態の文面を出し分けるためだけに使うので、取得失敗は画面を止めない。
      try {
        const flags = await apiFetch<MeFeatureFlags>("/api/v1/me/feature-flags");
        setLinkedServicesEnabled(flags.linked_services_enabled);
      } catch {
        setLinkedServicesEnabled(false);
      }
    })();
  }, [router]);

  function showComingSoon(label: string) {
    setToast(`${label}での利用は準備中です`);
    window.setTimeout(() => setToast(null), 1800);
  }

  return (
    <main className="relative flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">ORIを使う</h1>
      </header>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-6">
          <div className="rounded-full bg-sengoku-ink px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/30">
            {toast}
          </div>
        </div>
      )}

      {balance && (
        <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
          <p className="text-xs text-sengoku-muted">利用可能残高</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-sengoku-gold">{Number(balance.available_balance).toLocaleString("ja-JP")}</span>
            <span className="text-sm font-semibold text-sengoku-gold-soft">ORI</span>
          </p>
        </section>
      )}

      <p className="text-xs leading-relaxed text-sengoku-muted">連携済みサービスでORIを利用できます。</p>

      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}
      {!error && services === null && <p className="text-sm text-sengoku-muted">読み込み中...</p>}
      {services?.length === 0 && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-center text-xs text-sengoku-faint">
          {/* 連携サービス画面を隠しているときにそこへ誘導すると行き止まりになるため、
              文面を出し分ける (ENABLE_LINKED_SERVICES)。 */}
          {linkedServicesEnabled ? (
            <>
              利用可能な連携サービスがまだありません。まずは
              <Link href="/wallet/services" className="text-sengoku-gold underline underline-offset-2">
                連携サービス
              </Link>
              をご確認ください。
            </>
          ) : (
            "利用可能な連携サービスがまだありません。準備ができ次第、お知らせでご案内します。"
          )}
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
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sengoku-red/15 text-sengoku-red">
                <CartIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-sengoku-text">{s.service_name}</p>
              </span>
              <span className="shrink-0 text-xs font-bold text-sengoku-gold">利用する ›</span>
            </button>
          </li>
        ))}
      </ul>

      <BottomNavigation
        items={[
          { href: "/wallet", label: "ホーム", icon: <HomeIcon className="h-5 w-5" /> },
          { href: "/wallet/transactions", label: "履歴", icon: <ClockIcon className="h-5 w-5" />, matchPrefix: true },
          { href: "/wallet/earn", label: "貯める", icon: <GiftIcon className="h-5 w-5" /> },
          { href: "/wallet/use", label: "使う", icon: <CartIcon className="h-5 w-5" />, matchPrefix: true },
          { href: "/wallet/menu", label: "メニュー", icon: <MenuIcon className="h-5 w-5" /> },
        ]}
      />
    </main>
  );
}
