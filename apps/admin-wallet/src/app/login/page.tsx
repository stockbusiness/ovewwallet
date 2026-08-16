"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ mfaRequired: boolean; mfaToken?: string }>("/api/v1/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (res.mfaRequired && res.mfaToken) {
        setMfaToken(res.mfaToken);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/api/v1/admin/login/mfa", {
        method: "POST",
        body: JSON.stringify({ mfaToken, code }),
      });
      router.push("/dashboard");
    } catch (err) {
      // MFAチャレンジ切れ (401, "MFA challenge expired or invalid") とコード誤り (401, "invalid MFA code")
      // のどちらもエンドユーザー向けの日本語文言に置き換える (バックエンドの英語メッセージを出さない)。
      if (err instanceof ApiError && err.status === 401 && err.message.includes("expired")) {
        setError("認証セッションの有効期限が切れました。もう一度ログインし直してください。");
      } else {
        setError("認証コードが正しくありません");
      }
    } finally {
      setLoading(false);
    }
  }

  if (mfaToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-sengoku-bg">
        <form onSubmit={submitMfa} className="w-full max-w-sm rounded-xl border border-sengoku-border bg-sengoku-navy p-8 shadow">
          <h1 className="mb-1 font-heading text-lg font-bold text-sengoku-gold">二要素認証</h1>
          <p className="mb-6 text-sm text-sengoku-muted">認証アプリに表示されている6桁のコードを入力してください。</p>
          <label className="mb-4 block text-sm font-medium text-sengoku-text">
            認証コード
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-sengoku-border bg-sengoku-bg px-3 py-2 text-center text-lg tracking-[0.4em] text-sengoku-text"
              placeholder="000000"
            />
          </label>
          {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
          >
            確認してログイン
          </button>
          <button
            type="button"
            onClick={() => {
              setMfaToken(null);
              setCode("");
              setError(null);
            }}
            className="mt-3 w-full text-xs text-sengoku-muted underline"
          >
            メールアドレス・パスワードの入力からやり直す
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sengoku-bg">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-sengoku-border bg-sengoku-navy p-8 shadow">
        <h1 className="mb-1 font-heading text-lg font-bold text-sengoku-gold">千ノ国ウォレット管理画面</h1>
        <p className="mb-6 text-sm text-sengoku-muted">管理者アカウントでログインしてください。</p>
        <label className="mb-3 block text-sm font-medium text-sengoku-text">
          メールアドレス
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-sengoku-border bg-sengoku-bg px-3 py-2 text-sm text-sengoku-text"
          />
        </label>
        <label className="mb-4 block text-sm font-medium text-sengoku-text">
          パスワード
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-sengoku-border bg-sengoku-bg px-3 py-2 text-sm text-sengoku-text"
          />
        </label>
        {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
        >
          ログイン
        </button>
      </form>
    </main>
  );
}
