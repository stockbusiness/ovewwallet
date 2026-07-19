"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNavigation, ArrowLeftIcon, HomeIcon, ClockIcon, GiftIcon, CartIcon, MenuIcon } from "@ove/shared-ui";
import { apiFetch, ApiError, type LoginDevice } from "@/lib/api";

export default function LoginDevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<LoginDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await apiFetch<LoginDevice[]>("/api/v1/accounts/me/sessions"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await apiFetch(`/api/v1/accounts/me/sessions/${id}/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ログアウトに失敗しました");
    } finally {
      setRevokingId(null);
    }
  }

  async function revokeOthers() {
    setRevokingOthers(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ revoked_count: number }>("/api/v1/accounts/me/sessions/revoke-others", {
        method: "POST",
      });
      setMessage(`${result.revoked_count}件の端末からログアウトしました`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ログアウトに失敗しました");
    } finally {
      setRevokingOthers(false);
    }
  }

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet/menu" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">ログイン中の端末</h1>
      </header>

      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}
      {message && <p className="text-sm text-sengoku-gold">{message}</p>}
      {!error && devices === null && <p className="text-sm text-sengoku-muted">読み込み中...</p>}

      {devices !== null && devices.length > 1 && (
        <button
          type="button"
          onClick={revokeOthers}
          disabled={revokingOthers}
          className="self-start rounded-full border border-sengoku-red/40 px-4 py-2 text-xs font-bold text-sengoku-red disabled:opacity-50"
        >
          {revokingOthers ? "ログアウト中..." : "この端末以外からすべてログアウト"}
        </button>
      )}

      <ul className="flex flex-col gap-2">
        {devices?.map((d) => (
          <li key={d.id} className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold text-sengoku-text">
                  {d.device_label}
                  {d.is_current && (
                    <span className="rounded-full bg-sengoku-gold/15 px-2 py-0.5 text-xs font-bold text-sengoku-gold">
                      この端末
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-sengoku-faint">
                  最終利用: {d.last_used_at ? new Date(d.last_used_at).toLocaleString("ja-JP") : "-"}
                </p>
                <p className="mt-0.5 text-xs text-sengoku-faint">
                  ログイン日時: {new Date(d.issued_at).toLocaleString("ja-JP")}
                </p>
              </div>
              {!d.is_current && (
                <button
                  type="button"
                  onClick={() => revoke(d.id)}
                  disabled={revokingId === d.id}
                  className="shrink-0 rounded-full border border-sengoku-red/40 px-3 py-1.5 text-xs font-bold text-sengoku-red disabled:opacity-50"
                >
                  {revokingId === d.id ? "ログアウト中..." : "ログアウト"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

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
