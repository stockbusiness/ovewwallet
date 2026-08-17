"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, ApiError, type AdminMe } from "@/lib/api";

export default function SecuritySettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMe() {
    try {
      const data = await apiFetch<AdminMe>("/api/v1/admin/me");
      setMe(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  async function startSetup() {
    setError(null);
    setMessage(null);
    try {
      const data = await apiFetch<{ secret: string; otpauthUri: string }>("/api/v1/admin/mfa/setup", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSetupData(data);
    } catch {
      setError("MFA設定の開始に失敗しました");
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/v1/admin/mfa/enable", { method: "POST", body: JSON.stringify({ code: enableCode }) });
      setSetupData(null);
      setEnableCode("");
      setMessage("二要素認証を有効化しました。次回ログインから認証コードの入力が必要になります。");
      await loadMe();
    } catch {
      // ApiError.messageはバックエンドの英語メッセージのため使わず、常に日本語文言を表示する。
      setError("コードが正しくありません");
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/v1/admin/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      setDisablePassword("");
      setDisableCode("");
      setMessage("二要素認証を無効化しました。");
      await loadMe();
    } catch {
      // ApiError.messageはバックエンドの英語メッセージのため使わず、常に日本語文言を表示する。
      setError("パスワードまたはコードが正しくありません");
    }
  }

  if (!me) return <p className="p-6 text-sm text-sengoku-muted">読み込み中...</p>;

  return (
    <>
        <h1 className="mb-1 text-xl font-bold">セキュリティ設定</h1>
        <p className="mb-6 text-sm text-sengoku-muted">
          {me.displayName} ({me.email})
        </p>

        <HelpPanel storageKey="security" title="このページについて・使い方">
          <p>
            この画面は<strong className="text-sengoku-text">あなた自身のログインアカウント</strong>の二要素認証(MFA)を設定するためのものです。
            他の管理者のセキュリティ設定や、システム全体のセキュリティポリシーを変更する画面ではありません。
          </p>
          <div>
            <p className="font-semibold text-sengoku-text">設定手順</p>
            <ol className="ml-4 list-decimal">
              <li>「MFAを設定する」を押すと、シークレットキーと登録用URLが表示されます</li>
              <li>スマートフォンにGoogle Authenticator等の認証アプリを入れ、表示されたシークレットキーを手入力(またはQR対応アプリならURLから登録)</li>
              <li>認証アプリに表示された6桁のコードを入力し、「確認して有効化」を押す</li>
              <li>これ以降、ログイン時にパスワードに加えて認証アプリのコードが必要になります</li>
            </ol>
          </div>
          <p className="text-sengoku-gold-soft">
            重要: MFAを有効化した後、認証アプリを入れたスマートフォンを紛失・機種変更等でなくすと、
            この画面から自分で無効化することはできません(パスワードと現在のコードの両方が必要なため)。
            その場合は他の管理者・エンジニアに依頼してデータベース上で復旧してもらう必要があります。
            機種変更の際は、先に新しい端末で認証アプリの引き継ぎを済ませてから古い端末を手放してください。
          </p>
        </HelpPanel>

        {message && <p className="mb-4 rounded-md bg-sengoku-green/10 p-3 text-sm text-sengoku-green">{message}</p>}
        {error && <p className="mb-4 rounded-md bg-sengoku-red/10 p-3 text-sm text-sengoku-red">{error}</p>}

        <section className="rounded-lg border border-sengoku-border bg-sengoku-navy p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">二要素認証 (MFA)</h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                me.mfaEnabled ? "bg-emerald-100 text-sengoku-green" : "bg-sengoku-bg text-sengoku-muted"
              }`}
            >
              {me.mfaEnabled ? "有効" : "無効"}
            </span>
          </div>

          {!me.mfaEnabled && !setupData && (
            <div>
              <p className="mb-3 text-sm text-sengoku-muted">
                Google Authenticator などの認証アプリを使った二要素認証を設定できます。設定すると、次回以降の
                ログイン時にパスワードに加えて認証コードの入力が必要になります。
              </p>
              <button
                onClick={startSetup}
                className="rounded-md bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep"
              >
                MFAを設定する
              </button>
            </div>
          )}

          {!me.mfaEnabled && setupData && (
            <form onSubmit={confirmEnable} className="flex flex-col gap-3">
              <p className="text-sm text-sengoku-muted">
                認証アプリで以下のシークレットキーを手動入力するか、対応アプリで以下のURLを登録してください。
              </p>
              <div className="rounded-md bg-sengoku-navy-deep p-3 text-xs">
                <p className="mb-1 text-sengoku-muted">シークレットキー</p>
                <p className="break-all font-mono text-sm font-bold">{setupData.secret}</p>
              </div>
              <div className="rounded-md bg-sengoku-navy-deep p-3 text-xs">
                <p className="mb-1 text-sengoku-muted">登録用URL</p>
                <p className="break-all font-mono">{setupData.otpauthUri}</p>
              </div>
              <label className="text-sm font-medium">
                認証アプリに表示された6桁のコード
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={enableCode}
                  onChange={(e) => setEnableCode(e.target.value)}
                  className="mt-1 w-full rounded-md border border-sengoku-border px-3 py-2 text-center text-lg tracking-[0.4em]"
                  placeholder="000000"
                />
              </label>
              <button type="submit" className="rounded-md bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep">
                確認して有効化
              </button>
            </form>
          )}

          {me.mfaEnabled && (
            <form onSubmit={disableMfa} className="flex flex-col gap-3">
              <p className="text-sm text-sengoku-muted">
                MFAを無効化するには、パスワードと現在の認証コードの両方を入力してください。
              </p>
              <label className="text-sm font-medium">
                パスワード
                <input
                  type="password"
                  required
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  className="mt-1 w-full rounded-md border border-sengoku-border px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm font-medium">
                認証コード
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  className="mt-1 w-full rounded-md border border-sengoku-border px-3 py-2 text-center text-lg tracking-[0.4em]"
                  placeholder="000000"
                />
              </label>
              <button type="submit" className="rounded-md bg-sengoku-red px-4 py-2 text-sm font-semibold text-white">
                MFAを無効化する
              </button>
            </form>
          )}
        </section>
      </>  );
}
