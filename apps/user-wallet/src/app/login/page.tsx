"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrimaryButton, SecondaryButton, ChatBubbleIcon, IdCardIcon } from "@ove/shared-ui";
import { apiFetch, ApiError } from "@/lib/api";
import { isLiffConfigured, ensureLiffLogin, getLiffIdTokenIfLoggedIn } from "@/lib/liff";

type View = "choose" | "email-request" | "email-code" | "sengoku";

/** ブラウザ内で安定させた擬似LINEユーザーID (LIFF未設定のローカル開発・CI環境専用)。 */
function getMockLineUserId(): string {
  const key = "ove-mock-line-user-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  window.localStorage.setItem(key, generated);
  return generated;
}

export default function LoginPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sengokuMemberId, setSengokuMemberId] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"line" | "email" | "sengoku" | null>(null);

  // LIFFの login() はページ全体をLINEのログイン画面へ遷移させ、認証後にこの同じURLへ
  // 戻ってくる。戻ってきた直後にLIFFがログイン済みと判定できるので、その場合だけ
  // ここでログインを完了させる (LIFF未設定の環境ではgetLiffIdTokenIfLoggedIn()は
  // 常にnullを返し、何もしない)。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let result;
      try {
        result = await getLiffIdTokenIfLoggedIn();
      } catch (err) {
        // LINEへのログイン遷移後に戻ってきたのに失敗した場合はここに来る
        // (未訪問時のnullとは区別して、必ず画面にエラーを表示する)。
        if (!cancelled) setError(err instanceof Error ? err.message : "LINEログインに失敗しました");
        return;
      }
      if (!result || cancelled) return;
      setLoading("line");
      try {
        await apiFetch("/api/v1/auth/line/login", {
          method: "POST",
          body: JSON.stringify({ idToken: result.idToken, termsAccepted: result.termsAccepted }),
        });
        router.push("/wallet");
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "LINEログインに失敗しました");
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loginWithLine() {
    if (!termsAccepted) {
      setError("利用規約への同意が必要です");
      return;
    }
    setError(null);
    setLoading("line");
    try {
      if (isLiffConfigured()) {
        // ensureLiffLogin()は通常ページ遷移してここへは戻らない。
        // (既にLIFFログイン済みの場合のみ戻るが、そのケースは上のuseEffectが処理する)
        await ensureLiffLogin(termsAccepted);
        return;
      }
      const idToken = `mock.${getMockLineUserId()}`;
      await apiFetch("/api/v1/auth/line/login", {
        method: "POST",
        body: JSON.stringify({ idToken, termsAccepted }),
      });
      router.push("/wallet");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "LINEログインに失敗しました");
    } finally {
      setLoading(null);
    }
  }

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading("email");
    try {
      const res = await apiFetch<{ devCode?: string }>("/api/v1/auth/email/request-otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setDevCode(res.devCode ?? null);
      setView("email-code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "送信に失敗しました");
    } finally {
      setLoading(null);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!termsAccepted) {
      setError("利用規約への同意が必要です");
      return;
    }
    setError(null);
    setLoading("email");
    try {
      await apiFetch("/api/v1/auth/email/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email, code, termsAccepted }),
      });
      router.push("/wallet");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "認証に失敗しました");
    } finally {
      setLoading(null);
    }
  }

  async function loginWithSengokuPassport(e: React.FormEvent) {
    e.preventDefault();
    if (!termsAccepted) {
      setError("利用規約への同意が必要です");
      return;
    }
    setError(null);
    setLoading("sengoku");
    try {
      const { code: ssoCode } = await apiFetch<{ code: string }>("/api/v1/auth/sso/sengoku/dev-issue", {
        method: "POST",
        body: JSON.stringify({ sengokuMemberId }),
      });
      await apiFetch("/api/v1/auth/sso/sengoku/exchange", {
        method: "POST",
        body: JSON.stringify({ code: ssoCode, termsAccepted }),
      });
      router.push("/wallet");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "戦国パスポートIDでのログインに失敗しました");
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden px-6 pb-10 pt-16">
      <BackgroundGlow />

      <div className="relative flex flex-1 flex-col justify-center gap-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-sengoku-gold/50 bg-sengoku-navy">
            <span className="font-heading text-2xl font-bold text-sengoku-gold">戦</span>
          </div>
          <h1 className="font-heading text-2xl font-bold tracking-wide text-white">戦国ウォレット</h1>
          <p className="mt-1 text-xs font-semibold tracking-[0.2em] text-sengoku-gold">OVE WALLET</p>
        </div>

        {view === "choose" && (
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm leading-relaxed text-sengoku-muted">
              OVEウォレットへようこそ。
              <br />
              ご利用のログイン方法を選択してください。
            </p>
            <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
            <PrimaryButton fullWidth onClick={loginWithLine} disabled={loading !== null}>
              <ChatBubbleIcon className="h-5 w-5" />
              {loading === "line" ? "ログイン中..." : "LINEでログイン"}
            </PrimaryButton>
            <SecondaryButton fullWidth tone="gold" onClick={() => setView("email-request")} disabled={loading !== null}>
              メールでログイン
            </SecondaryButton>
            <SecondaryButton fullWidth tone="neutral" onClick={() => setView("sengoku")} disabled={loading !== null}>
              <IdCardIcon className="h-5 w-5" />
              戦国パスポートIDでログイン
            </SecondaryButton>
          </div>
        )}

        {view === "email-request" && (
          <form onSubmit={requestOtp} className="flex flex-col gap-4">
            <label className="text-sm font-semibold text-white">
              メールアドレス
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-sengoku-border bg-sengoku-navy px-4 py-3 text-base text-white placeholder:text-sengoku-faint focus:border-sengoku-gold focus:outline-none"
                placeholder="you@example.com"
              />
            </label>
            <PrimaryButton type="submit" fullWidth disabled={loading !== null}>
              {loading === "email" ? "送信中..." : "確認コードを送信"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setView("choose")}
              className="text-sm font-medium text-sengoku-muted underline underline-offset-2"
            >
              戻る
            </button>
          </form>
        )}

        {view === "email-code" && (
          <form onSubmit={verifyOtp} className="flex flex-col gap-4">
            <p className="text-sm text-sengoku-muted">{email} に6桁の確認コードを送信しました。</p>
            {devCode && (
              <p className="rounded-lg border border-sengoku-gold/40 bg-sengoku-gold/10 p-3 text-xs text-sengoku-gold-soft">
                開発環境用コード: <span className="font-mono text-sm font-bold">{devCode}</span>
              </p>
            )}
            <label className="text-sm font-semibold text-white">
              確認コード
              <input
                type="text"
                inputMode="numeric"
                required
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-sengoku-border bg-sengoku-navy px-4 py-3 text-center text-lg tracking-[0.5em] text-white placeholder:text-sengoku-faint focus:border-sengoku-gold focus:outline-none"
                placeholder="000000"
              />
            </label>
            <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
            <PrimaryButton type="submit" fullWidth disabled={loading !== null}>
              {loading === "email" ? "確認中..." : "ログイン"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setView("email-request")}
              className="text-sm font-medium text-sengoku-muted underline underline-offset-2"
            >
              メールアドレスを変更する
            </button>
          </form>
        )}

        {view === "sengoku" && (
          <form onSubmit={loginWithSengokuPassport} className="flex flex-col gap-4">
            <label className="text-sm font-semibold text-white">
              戦国パスポート会員ID
              <input
                type="text"
                required
                autoFocus
                value={sengokuMemberId}
                onChange={(e) => setSengokuMemberId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-sengoku-border bg-sengoku-navy px-4 py-3 text-base text-white placeholder:text-sengoku-faint focus:border-sengoku-gold focus:outline-none"
                placeholder="SP-000000"
              />
            </label>
            <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
            <PrimaryButton type="submit" fullWidth disabled={loading !== null}>
              {loading === "sengoku" ? "連携中..." : "戦国パスポートIDでログイン"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setView("choose")}
              className="text-sm font-medium text-sengoku-muted underline underline-offset-2"
            >
              戻る
            </button>
          </form>
        )}

        {error && <p className="text-center text-sm font-medium text-sengoku-gold-soft">{error}</p>}
      </div>
    </main>
  );
}

function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 text-xs leading-relaxed text-sengoku-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-sengoku-gold"
      />
      <span>
        <Link href="/terms" target="_blank" className="text-sengoku-gold underline underline-offset-2">
          利用規約
        </Link>
        に同意する (初めてご利用の方は同意が必要です)
      </span>
    </label>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-sengoku-gold/10 blur-3xl" />
      <svg
        className="absolute inset-x-0 bottom-0 h-40 w-full text-sengoku-navy"
        viewBox="0 0 400 120"
        preserveAspectRatio="none"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M0 120V70l40-22 25 12 35-30 30 20 20-10 45 24 15-8 30 16 20-14 40 22 20-6 30 14 20-10 35 18V120Z" />
      </svg>
    </div>
  );
}
