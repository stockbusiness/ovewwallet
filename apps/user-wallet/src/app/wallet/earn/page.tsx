"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BottomNavigation,
  SERVICE_CODE_LABEL,
  GiftIcon,
  ArrowLeftIcon,
  HomeIcon,
  ClockIcon,
  CartIcon,
  MenuIcon,
} from "@ove/shared-ui";
import { apiFetch, ApiError, type RewardRulePublic } from "@/lib/api";

export default function EarnOvePage() {
  const router = useRouter();
  const [rules, setRules] = useState<RewardRulePublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiFetch<RewardRulePublic[]>("/api/v1/rewards/public");
        setRules(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      }
    })();
  }, [router]);

  function showComingSoon(label: string) {
    setToast(`${label}への案内は準備中です`);
    window.setTimeout(() => setToast(null), 1800);
  }

  return (
    <main className="relative flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">ORIを貯める</h1>
      </header>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-6">
          <div className="rounded-full bg-sengoku-ink px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/30">
            {toast}
          </div>
        </div>
      )}

      <p className="text-xs leading-relaxed text-sengoku-muted">
        連携サービスでの活動に応じてORIを獲得できます。現在開催中の獲得機会は以下の通りです。
      </p>

      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}
      {!error && rules === null && <p className="text-sm text-sengoku-muted">読み込み中...</p>}
      {rules?.length === 0 && (
        <p className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-center text-xs text-sengoku-faint">
          現在開催中の獲得機会はありません
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rules?.map((r) => {
          const body = (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sengoku-green/15 text-sengoku-green">
                <GiftIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-sengoku-text">{r.display_name}</p>
                {r.description && <p className="mt-0.5 text-xs leading-relaxed text-sengoku-muted">{r.description}</p>}
                <p className="mt-1 text-xs text-sengoku-faint">{SERVICE_CODE_LABEL[r.source_service] ?? r.source_service}</p>
                {r.expiry_days != null && (
                  <p className="mt-1 text-xs text-sengoku-faint">獲得から{r.expiry_days}日で失効します</p>
                )}
                {r.already_earned && <p className="mt-1 text-xs text-sengoku-faint">受け取り済み</p>}
                {r.landing_url && !r.already_earned && (
                  <p className="mt-1 text-xs font-semibold text-sengoku-gold">参加する →</p>
                )}
              </span>
              <span className="shrink-0 text-sm font-bold text-sengoku-green">
                +{Number(r.reward_amount).toLocaleString("ja-JP")}
                <span className="ml-0.5 text-xs font-medium">ORI</span>
              </span>
            </>
          );
          const className =
            "flex w-full items-start gap-3 rounded-xl border border-sengoku-border bg-sengoku-navy p-4 text-left transition-colors active:bg-sengoku-text/5";

          return (
            <li key={r.rule_code}>
              {/* 案内先が設定されていれば実際のリンクにする。未設定のときだけ従来の
                  「準備中です」を出す (導線の無いサービスもあるため)。 */}
              {r.landing_url ? (
                <a
                  href={`${r.landing_url}${r.landing_url.includes("?") ? "&" : "?"}utm_source=ori_wallet&utm_medium=earn_list`}
                  target="_blank"
                  // 遷移先から window.opener 経由でこの画面を操作されないようにする
                  rel="noopener noreferrer"
                  className={className}
                >
                  {body}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => showComingSoon(SERVICE_CODE_LABEL[r.source_service] ?? r.source_service)}
                  className={className}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <BottomNavigation
        items={[
          { href: "/wallet", label: "ホーム", icon: <HomeIcon className="h-5 w-5" /> },
          { href: "/wallet/transactions", label: "履歴", icon: <ClockIcon className="h-5 w-5" />, matchPrefix: true },
          { href: "/wallet/earn", label: "貯める", icon: <GiftIcon className="h-5 w-5" />, matchPrefix: true },
          { href: "/wallet/use", label: "使う", icon: <CartIcon className="h-5 w-5" /> },
          { href: "/wallet/menu", label: "メニュー", icon: <MenuIcon className="h-5 w-5" /> },
        ]}
      />
    </main>
  );
}
