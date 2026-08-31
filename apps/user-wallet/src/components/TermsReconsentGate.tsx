"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, type TermsConsentStatus } from "@/lib/api";

/**
 * 規約が改定されたときに再同意を求める関門 (docs/terms-consent.md)。
 *
 * 同意するまでウォレットの画面を出さない。閲覧系APIは再同意前でも通るため画面自体は
 * 描けるが、更新系がすべて403になるので「操作しようとするたびにエラーが出る」状態に
 * なってしまう。先に同意を求めるほうが分かりやすい。
 *
 * ログインしていない場合 (401) は何もしない。各ページ側が`/login`へ誘導するため、
 * ここで二重に遷移させるとちらつく。
 */
export function TermsReconsentGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<TermsConsentStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<TermsConsentStatus>("/api/v1/accounts/me/terms");
        if (!cancelled) setStatus(res);
      } catch {
        // 未ログイン・通信失敗時は関門を出さない (ページ側の処理に委ねる)。
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function accept() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/v1/accounts/me/terms/accept", { method: "POST" });
      setStatus(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "同意の記録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // 失敗してもログイン画面へ戻す (サーバー側セッションはTTLで失効する)。
    }
    router.push("/login");
  }

  // 確認が終わるまでは何も出さない。先に子を描くと、再同意画面が後から
  // かぶさってちらつくため。
  if (!checked) return null;
  if (!status?.consent_required) return <>{children}</>;

  return (
    <main className="flex min-h-screen flex-col justify-center gap-5 px-6 py-10">
      <div>
        <h1 className="font-heading text-xl font-bold text-sengoku-text">利用規約が変わりました</h1>
        <p className="mt-2 text-sm leading-relaxed text-sengoku-muted">
          ORIをご利用いただくには、新しい利用規約 (バージョン {status.current_version}) への同意が必要です。
        </p>
        {status.agreed_version && (
          <p className="mt-1 text-xs text-sengoku-faint">
            現在同意いただいているバージョン: {status.agreed_version}
          </p>
        )}
      </div>

      <Link
        href="/terms"
        className="rounded-lg border border-sengoku-border px-4 py-3 text-center text-sm text-sengoku-gold underline"
      >
        利用規約を読む
      </Link>

      {error && <p className="text-sm text-sengoku-red">{error}</p>}

      <button
        onClick={accept}
        disabled={submitting}
        className="rounded-lg bg-sengoku-gold px-4 py-3 text-sm font-bold text-sengoku-navy-deep disabled:opacity-50"
      >
        {submitting ? "送信中..." : "同意して続ける"}
      </button>

      {/* 同意しない選択肢を必ず残す。同意を強いる形にしない。 */}
      <button onClick={logout} className="text-sm text-sengoku-muted underline">
        同意せずログアウトする
      </button>
      <p className="text-center text-xs text-sengoku-faint">
        退会をご希望の場合は、ログイン後にメニューからお手続きいただけます。
      </p>
    </main>
  );
}
