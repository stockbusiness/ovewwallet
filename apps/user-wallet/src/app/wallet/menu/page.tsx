"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BottomNavigation,
  ThemeToggle,
  ArrowLeftIcon,
  ChevronRightIcon,
  HomeIcon,
  ClockIcon,
  GiftIcon,
  CartIcon,
  MenuIcon,
} from "@ove/shared-ui";
import { apiFetch, ApiError, type OveAccount, type WalletBalance, type ReferralStatus } from "@/lib/api";

const REFERRAL_STATUS_LABEL: Record<"PENDING" | "CONFIRMED" | "REJECTED" | "REVOKED", string> = {
  PENDING: "審査中",
  CONFIRMED: "付与済み",
  REJECTED: "対象外",
  REVOKED: "取消済み",
};

export default function WalletMenuPage() {
  const router = useRouter();
  const [account, setAccount] = useState<OveAccount | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [referralStatus, setReferralStatus] = useState<ReferralStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [closingAccount, setClosingAccount] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [acc, bal] = await Promise.all([
          apiFetch<OveAccount>("/api/v1/accounts/me"),
          apiFetch<WalletBalance>("/api/v1/me/wallet"),
        ]);
        setAccount(acc);
        setBalance(bal);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
        return;
      }
      // 紹介登録でないユーザーが大多数のため、取得失敗はメニュー画面自体を止めない
      try {
        setReferralStatus(await apiFetch<ReferralStatus>("/api/v1/me/referral-status"));
      } catch {
        setReferralStatus({ referred: false });
      }
    })();
  }, [router]);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // ログアウトAPIが失敗してもローカルでは遷移させる (セッション切れ等)
    } finally {
      router.push("/login");
    }
  }

  async function closeAccount() {
    if (!window.confirm("退会すると、このアカウントには二度とログインできなくなります。よろしいですか？")) return;

    setError(null);
    setClosingAccount(true);
    try {
      await apiFetch("/api/v1/accounts/me/close", { method: "POST" });
      // 退会成功時点でサーバー側のセッションは既に失効しているため、ここでのlogout呼び出しは
      // ブラウザ側のCookieを消すためだけのもの (失敗しても退会自体は成立している)。
      await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
      router.push("/login");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 400
            ? "残高が残っているため退会できません。OVEを使い切ってから再度お試しください。"
            : err.message
          : "退会に失敗しました",
      );
      setClosingAccount(false);
    }
  }

  return (
    <main className="flex flex-col gap-6 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">メニュー</h1>
      </header>

      {error && <p className="text-sm text-sengoku-gold-soft">{error}</p>}

      <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
        <p className="text-sm font-bold text-sengoku-text">{account?.displayName || "表示名未設定"}</p>
        <p className="mt-1 text-xs text-sengoku-muted">{account?.accountCode}</p>
        {balance && <p className="mt-0.5 text-xs text-sengoku-muted">{balance.wallet_code}</p>}
      </section>

      {referralStatus?.referred && (
        <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
          <p className="text-sm font-bold text-sengoku-text">紹介登録特典</p>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-sengoku-muted">{REFERRAL_STATUS_LABEL[referralStatus.status]}</span>
            <span className="font-bold text-sengoku-gold">{Number(referralStatus.amount).toLocaleString("ja-JP")} OVE</span>
          </div>
          {referralStatus.status === "CONFIRMED" && referralStatus.confirmed_at && (
            <p className="mt-1 text-xs text-sengoku-faint">
              {new Date(referralStatus.confirmed_at).toLocaleDateString("ja-JP")}付与
            </p>
          )}
          {(referralStatus.status === "REJECTED" || referralStatus.status === "REVOKED") && referralStatus.reason && (
            <p className="mt-1 text-xs text-sengoku-faint">{referralStatus.reason}</p>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-sengoku-border bg-sengoku-navy">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-sengoku-text">表示テーマ</span>
          <ThemeToggle />
        </div>
        <MenuLink href="/wallet/services" label="連携サービス" />
        <MenuLink href="/wallet/earn" label="OVEを貯める" />
        <MenuLink href="/wallet/use" label="OVEを使う" />
        <MenuLink href="/wallet/devices" label="ログイン中の端末" />
        <MenuLink href="/about" label="OVEについて" />
        <MenuLink href="/terms" label="利用規約" />
      </section>

      <button
        type="button"
        onClick={logout}
        disabled={loggingOut}
        className="rounded-xl border border-sengoku-red/40 bg-sengoku-red/10 py-3 text-sm font-bold text-sengoku-red transition-colors hover:bg-sengoku-red/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loggingOut ? "ログアウト中..." : "ログアウト"}
      </button>

      <button
        type="button"
        onClick={closeAccount}
        disabled={closingAccount}
        className="py-2 text-xs text-sengoku-faint underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        {closingAccount ? "退会処理中..." : "退会する"}
      </button>

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

function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between border-t border-sengoku-border px-4 py-3 text-sm font-semibold text-sengoku-text transition-colors hover:bg-sengoku-text/5"
    >
      {label}
      <ChevronRightIcon className="h-4 w-4 text-sengoku-muted" />
    </Link>
  );
}
