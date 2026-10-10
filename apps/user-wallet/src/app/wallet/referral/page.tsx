"use client";

import { BottomNavigation, ArrowLeftIcon, HomeIcon, ClockIcon, GiftIcon, CartIcon, MenuIcon } from "@ove/shared-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ReferralListSection from "@/components/referral/ReferralListSection";
import ReferralShareSection from "@/components/referral/ReferralShareSection";
import { apiFetch, ApiError, type WalletUserReferralSummary } from "@/lib/api";

/**
 * 「お友達を紹介」画面 (`docs/wallet-user-referral.md`)。
 *
 * 代理店紹介 (メニューの「紹介登録特典」) は**自分が紹介された側**の話で、
 * こちらは**自分が紹介した側**の話。混同されやすいので文言で区別する。
 */
export default function ReferralPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<WalletUserReferralSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setSummary(await apiFetch<WalletUserReferralSummary>("/api/v1/me/wallet-user-referrals"));
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
        <Link href="/wallet/menu" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">お友達を紹介</h1>
      </header>

      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}
      {!error && summary === null && <p className="text-sm text-sengoku-muted">読み込み中...</p>}

      {summary && !summary.enabled && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-sm text-sengoku-muted">
          紹介のご案内は準備中です。開始までしばらくお待ちください。
        </p>
      )}

      {summary?.enabled && summary.url && (
        <>
          <ReferralShareSection url={summary.url} />
          <ReferralListSection referrals={summary.referrals} count={summary.referred_count} />
        </>
      )}

      <BottomNavigation
        items={[
          { href: "/wallet", label: "ホーム", icon: <HomeIcon className="h-5 w-5" /> },
          { href: "/wallet/transactions", label: "履歴", icon: <ClockIcon className="h-5 w-5" />, matchPrefix: true },
          { href: "/wallet/earn", label: "貯める", icon: <GiftIcon className="h-5 w-5" /> },
          { href: "/wallet/use", label: "使う", icon: <CartIcon className="h-5 w-5" /> },
          { href: "/wallet/menu", label: "メニュー", icon: <MenuIcon className="h-5 w-5" />, matchPrefix: true },
        ]}
      />
    </main>
  );
}
