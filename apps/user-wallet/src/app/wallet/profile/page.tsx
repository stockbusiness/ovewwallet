"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNavigation, ArrowLeftIcon, HomeIcon, ClockIcon, GiftIcon, CartIcon, MenuIcon } from "@ove/shared-ui";
import { ProfileForm } from "@/components/ProfileForm";
import { apiFetch, ApiError, type AccountProfileResponse } from "@/lib/api";

/**
 * プロフィール入力画面 (docs/account-profile.md)。
 *
 * 必須項目が空でも保存でき、ウォレットの利用も止まらない。「入力しない」を選べる
 * のは体裁ではなく、断ったこと自体を記録に残すため。
 */
export default function ProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<AccountProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<AccountProfileResponse>("/api/v1/accounts/me/profile"));
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

  async function save(values: Record<string, string>) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      setData(
        await apiFetch<AccountProfileResponse>("/api/v1/accounts/me/profile", {
          method: "PUT",
          body: JSON.stringify(values),
        }),
      );
      setMessage("保存しました");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function decline() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      setData(
        await apiFetch<AccountProfileResponse>("/api/v1/accounts/me/profile/decline", { method: "POST" }),
      );
      setMessage("承知しました。以降はお願いを表示しません");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet/menu" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">お客様情報</h1>
      </header>

      <p className="text-xs leading-relaxed text-sengoku-faint">
        お名前・ご連絡先は、特典のご案内やお届けのためだけに使用します。
        ご記入いただかなくてもウォレットはこれまでどおりご利用いただけます。
        取り扱いは
        <Link href="/terms" className="mx-1 underline">
          利用規約
        </Link>
        をご確認ください。
      </p>

      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}
      {message && <p className="text-sm text-sengoku-gold">{message}</p>}
      {!error && data === null && <p className="text-sm text-sengoku-muted">読み込み中...</p>}

      {data && <ProfileForm data={data} saving={saving} onSave={save} />}

      {data && !data.profile.declinedAt && (
        <button
          type="button"
          onClick={decline}
          disabled={saving}
          className="self-center text-xs text-sengoku-faint underline disabled:opacity-50"
        >
          今回は入力しない
        </button>
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
