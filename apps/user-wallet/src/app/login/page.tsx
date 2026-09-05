"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PrimaryButton, AuthButton, ThemeToggle, ChatBubbleIcon, MailIcon, IdCardIcon, WalletLogo } from "@ove/shared-ui";
import { apiFetch, ApiError, type LoginMethodAvailability } from "@/lib/api";
import { sanitizeInternalReturnPath } from "@/lib/claim-return-path";
import { describeLineLoginError } from "@/lib/line-login-error";
import { TermsCheckbox } from "@/components/TermsCheckbox";
import {
  isLiffConfigured,
  ensureLiffLogin,
  getLiffIdTokenIfLoggedIn,
  getPendingSubmission,
  clearPendingSubmission,
  incrementPendingSubmitAttempts,
  MAX_PENDING_SUBMIT_ATTEMPTS,
} from "@/lib/liff";

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
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

/**
 * `useSearchParams()`(`?return_to=`の読み取りに使用)はNext.js App Routerの
 * 静的プリレンダリング時にSuspense境界を要求するため、本体を分離している。
 */
function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // NFTカードClaim導線実装指示書5章。ログイン完了後にどこへ戻るかは、この1箇所で
  // 一度だけ計算し、LINE/メールOTP/千ノ国パスポートSSOの全経路が同じ値を使う。
  // 不正な値(絶対URL・許可Prefix外)はnullになり、既定の"/wallet"へ遷移する。
  const postLoginRedirect = sanitizeInternalReturnPath(searchParams.get("return_to")) ?? "/wallet";
  const [view, setView] = useState<View>("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sengokuMemberId, setSengokuMemberId] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"line" | "email" | "sengoku" | null>(null);
  // どのログイン方法を出すかはサーバーが決める (docs/login-methods.md)。
  // 稼働開始時点で使えるのはLINEのみで、メール・SSOは実装/接続が未了。
  // 取得できるまでは何も出さない (使えない選択肢を一瞬でも見せないため)。
  const [methods, setMethods] = useState<LoginMethodAvailability | null>(null);
  // LIFFの login() はページ全体をLINEのログイン画面へ遷移させ、認証後にこの同じURLへ
  // 戻ってくる。戻ってきた直後にLIFFがログイン済みと判定できるので、その場合だけ
  // ここでログインを完了させる (LIFF未設定の環境ではgetLiffIdTokenIfLoggedIn()は
  // 常にnullを返し、何もしない)。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 直前の試行でAPI送信・画面遷移が完了する前にページがリロードされていた
      // 場合、保存済みのIDトークンがあればliff.init()を再実行せず直接送信する。
      // iOSのLIFF SDKには`pageshow`イベントで自動的に`location.reload()`する
      // 挙動があり(実チャネルでの結合試験(2026-07-18)で確認)、liff.init()を
      // 呼ぶたびにこれが再発火してリロードを繰り返すループになっていたため、
      // 一度IDトークンを取得できたら以後はliff.init()を経由しないようにする。
      const pending = getPendingSubmission();
      let result;
      if (pending) {
        result = pending;
      } else {
        try {
          result = await getLiffIdTokenIfLoggedIn();
        } catch (err) {
          // LINEへのログイン遷移後に戻ってきたのに失敗した場合はここに来る
          // (未訪問時のnullとは区別して、必ず画面にエラーを表示する)。
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "LINEログインに失敗しました");
          }
          return;
        }
        // 送信待ちとしての保存はgetLiffIdTokenIfLoggedIn()内部で(呼び出し元に
        // 返る前に)即座に行われる。ここで改めて保存する必要はない。
      }
      if (!result || cancelled) return;

      // トークン失効等でAPI送信が恒久的に失敗し続けるケースで、送信待ちの
      // IDトークンを無限に再送し続けないよう上限を設ける。
      const attempts = incrementPendingSubmitAttempts();
      if (attempts > MAX_PENDING_SUBMIT_ATTEMPTS) {
        clearPendingSubmission();
        if (!cancelled) {
          setError("LINEログインの送信が繰り返し失敗しました。もう一度最初からお試しください。");
        }
        return;
      }

      setLoading("line");
      try {
        await apiFetch("/api/v1/auth/line/login", {
          method: "POST",
          body: JSON.stringify({ idToken: result.idToken, termsAccepted: result.termsAccepted }),
        });
        // 送信・遷移が両方完了して初めて送信待ちを消す。この間にリロードが割り込んだ
        // 場合は消さずに残しておき、次の読み込みで(liff.init()を経由せず)同じ
        // IDトークンで送信をやり直せるようにする (2026-07-18、pageshowリロード対策)。
        clearPendingSubmission();
        router.push(postLoginRedirect);
      } catch (err) {
        const info = describeLineLoginError(err);
        // 送信待ちを残すのは「同じIDトークンでやり直せば通る」場合だけ
        // (pageshowリロード対策、上記コメント参照)。規約未同意のように何度送っても
        // 通らない失敗で残すと、再送上限に達するまで同じ失敗を繰り返す。
        if (!info.retryable) clearPendingSubmission();
        if (!cancelled) {
          setError(info.message);
        }
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<LoginMethodAvailability>("/api/v1/auth/methods");
        if (!cancelled) setMethods(res);
      } catch {
        // 取得に失敗してもログインの道は残す。唯一使える方法であるLINEだけを出す。
        if (!cancelled) setMethods({ line: true, email: false, sengoku_passport: false, agency: false });
      }
    })();
    return () => {
      cancelled = true;
    };
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
        // ensureLiffLogin()は常にLINEへ遷移し、ここへは戻らない
        // (既存のログイン状態が残っていても一度ログアウトしてから遷移し直す)。
        // 復帰後の処理は上のuseEffect (getLiffIdTokenIfLoggedIn) が担当する。
        await ensureLiffLogin(termsAccepted);
        return;
      }
      const idToken = `mock.${getMockLineUserId()}`;
      await apiFetch("/api/v1/auth/line/login", {
        method: "POST",
        body: JSON.stringify({ idToken, termsAccepted }),
      });
      router.push(postLoginRedirect);
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
      router.push(postLoginRedirect);
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
      router.push(postLoginRedirect);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "千ノ国パスポートIDでのログインに失敗しました");
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-sengoku-bg pb-10">
      <WalletHero compact={view !== "choose"} />
      <ThemeToggle className="absolute right-4 top-4 z-20 bg-black/20 backdrop-blur" />

      <div className="relative z-10 flex flex-1 flex-col gap-8 px-6">
        {view === "choose" && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <h2 className="text-lg font-bold text-sengoku-text">千ノ国ウォレットへようこそ</h2>
              <p className="mt-1 text-sm text-sengoku-muted">千の物語と活動を、ひとつにつなぐ</p>
            </div>
            {methods?.line && (
              <AuthButton
                variant="line"
                icon={<ChatBubbleIcon className="h-4 w-4" />}
                onClick={loginWithLine}
                disabled={loading !== null}
              >
                {loading === "line" ? "ログイン中..." : "LINEでログイン"}
              </AuthButton>
            )}
            {methods?.email && (
              <AuthButton
                variant="email"
                icon={<MailIcon className="h-4 w-4" />}
                onClick={() => {
                  setError(null);
                  setView("email-request");
                }}
                disabled={loading !== null}
              >
                メールでログイン
              </AuthButton>
            )}
            {methods?.sengoku_passport && (
              <AuthButton
                variant="sengoku"
                icon={<IdCardIcon className="h-4 w-4" />}
                onClick={() => {
                  setError(null);
                  setView("sengoku");
                }}
                disabled={loading !== null}
              >
                千ノ国パスポートIDでログイン
              </AuthButton>
            )}
            <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
            <Link href="/terms" className="text-center text-xs font-medium text-sengoku-gold underline underline-offset-2">
              ログインに関するヘルプ
            </Link>
          </div>
        )}

        {view === "email-request" && (
          <form onSubmit={requestOtp} className="flex flex-col gap-4">
            <label className="text-sm font-semibold text-sengoku-text">
              メールアドレス
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-sengoku-border bg-sengoku-navy px-4 py-3 text-base text-sengoku-text placeholder:text-sengoku-faint focus:border-sengoku-gold focus:outline-none"
                placeholder="you@example.com"
              />
            </label>
            <PrimaryButton type="submit" fullWidth disabled={loading !== null}>
              {loading === "email" ? "送信中..." : "確認コードを送信"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView("choose");
              }}
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
            <label className="text-sm font-semibold text-sengoku-text">
              確認コード
              <input
                type="text"
                inputMode="numeric"
                required
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-sengoku-border bg-sengoku-navy px-4 py-3 text-center text-lg tracking-[0.5em] text-sengoku-text placeholder:text-sengoku-faint focus:border-sengoku-gold focus:outline-none"
                placeholder="000000"
              />
            </label>
            <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
            <PrimaryButton type="submit" fullWidth disabled={loading !== null}>
              {loading === "email" ? "確認中..." : "ログイン"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView("email-request");
              }}
              className="text-sm font-medium text-sengoku-muted underline underline-offset-2"
            >
              メールアドレスを変更する
            </button>
          </form>
        )}

        {view === "sengoku" && (
          <form onSubmit={loginWithSengokuPassport} className="flex flex-col gap-4">
            <label className="text-sm font-semibold text-sengoku-text">
              千ノ国パスポート会員ID
              <input
                type="text"
                required
                autoFocus
                value={sengokuMemberId}
                onChange={(e) => setSengokuMemberId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-sengoku-border bg-sengoku-navy px-4 py-3 text-base text-sengoku-text placeholder:text-sengoku-faint focus:border-sengoku-gold focus:outline-none"
                placeholder="SP-000000"
              />
            </label>
            <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
            <PrimaryButton type="submit" fullWidth disabled={loading !== null}>
              {loading === "sengoku" ? "連携中..." : "千ノ国パスポートIDでログイン"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView("choose");
              }}
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

/**
 * ログイン画面上部の演出。千ノ国ウォレットの円環ロゴモチーフを中心に据える
 * (2026-07-19、千ノ国ブランドへの刷新に伴い旧CastleHero(霧の山並み・城の
 * シルエット)を置き換え。戦国専用モチーフは共通UIに残さない方針のため)。
 * choose以外のビュー(メール入力等)ではcompactにして操作の邪魔をしない。
 */
function WalletHero({ compact }: { compact: boolean }) {
  return (
    <div className={`relative overflow-hidden transition-[height] duration-300 ${compact ? "h-40" : "h-[52vh] min-h-[340px]"}`}>
      <div className="absolute inset-0 bg-gradient-to-b from-sengoku-navy-deep via-sengoku-bg to-sengoku-bg" />

      {!compact && (
        <div className="absolute inset-x-0 top-[18%] flex flex-col items-center gap-4">
          <WalletLogo className="h-28 w-28 text-sengoku-gold sm:h-32 sm:w-32" />
          <div className="text-center">
            <p className="font-heading text-3xl font-bold leading-tight text-sengoku-text sm:text-4xl">千ノ国ウォレット</p>
            <p className="mt-1 text-xs font-semibold tracking-[0.35em] text-sengoku-gold">SEN NO KUNI WALLET</p>
          </div>
        </div>
      )}

      {compact && (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-2">
          <WalletLogo className="h-8 w-8 text-sengoku-gold" />
          <p className="font-heading text-xl font-bold text-sengoku-text">千ノ国ウォレット</p>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-sengoku-bg to-transparent" />
    </div>
  );
}
