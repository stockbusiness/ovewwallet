"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

type Step = "email" | "code";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ devCode?: string }>("/api/v1/auth/email/request-otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setDevCode(res.devCode ?? null);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "送信に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/api/v1/auth/email/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      router.push("/wallet");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "認証に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-brand-700">OVEウォレット</h1>
        <p className="mt-1 text-sm text-neutral-500">メールアドレスでログイン・新規登録します。</p>
      </div>

      {step === "email" && (
        <form onSubmit={requestOtp} className="flex flex-col gap-3">
          <label className="text-sm font-medium">
            メールアドレス
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="you@example.com"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            確認コードを送信
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyOtp} className="flex flex-col gap-3">
          <p className="text-sm text-neutral-600">{email} に6桁のコードを送信しました。</p>
          {devCode && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-700">
              開発環境用コード: <span className="font-mono font-bold">{devCode}</span>
            </p>
          )}
          <label className="text-sm font-medium">
            確認コード
            <input
              type="text"
              inputMode="numeric"
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm tracking-widest"
              placeholder="000000"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            ログイン
          </button>
          <button type="button" onClick={() => setStep("email")} className="text-xs text-neutral-500 underline">
            メールアドレスを変更する
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
