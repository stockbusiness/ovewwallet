"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, ApiError, type MailConfig, type MailTestResult } from "@/lib/api";

/**
 * メール送信設定 (docs/login-methods.md)。ワンタイムコードの配信に使う。
 *
 * APIキーは一度保存すると生値を二度と表示せず、末尾4文字だけのマスク表示になる
 * (共通顧客HUB送信設定と同じ)。テスト送信は**保存済みの設定**で行うので、
 * 先に保存してから試す。
 */
export default function MailConfigPage() {
  const router = useRouter();
  const [config, setConfig] = useState<MailConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [mailFrom, setMailFrom] = useState("");
  const [reason, setReason] = useState("");

  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MailTestResult | null>(null);

  const load = useCallback(async () => {
    try {
      const current = await apiFetch<MailConfig>("/api/v1/admin/mail-config");
      setConfig(current);
      setMailFrom(current.mailFrom);
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

  async function save() {
    if (!reason.trim()) {
      setError("変更理由を入力してください");
      return;
    }
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const body: Record<string, string> = { reason: reason.trim() };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (mailFrom.trim()) body.mailFrom = mailFrom.trim();

      setConfig(
        await apiFetch<MailConfig>("/api/v1/admin/mail-config", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      setApiKey("");
      setReason("");
      setMessage("保存しました");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) {
      setError("テスト送信先のメールアドレスを入力してください");
      return;
    }
    setError(null);
    setTestResult(null);
    setTesting(true);
    try {
      setTestResult(
        await apiFetch<MailTestResult>("/api/v1/admin/mail-config/test", {
          method: "POST",
          body: JSON.stringify({ to: testTo.trim() }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "テスト送信に失敗しました");
    } finally {
      setTesting(false);
    }
  }

  const testResultClass =
    testResult?.outcome === "ok"
      ? "bg-sengoku-green/10 text-sengoku-green"
      : "bg-sengoku-red/10 text-sengoku-red";

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">メール送信設定</h1>
      <p className="mb-4 text-xs text-sengoku-muted">
        メールでログイン・新規登録する利用者へ、6桁の確認コードを送るための設定です。
        LINEを持っていない方のための入口なので、ここが未設定だとログイン画面にメールの
        選択肢が出ません。
      </p>

      <HelpPanel storageKey="mail-config" title="このページについて・設定手順">
        <div>
          <p className="font-semibold text-sengoku-text">事前に必要なもの</p>
          <ol className="ml-4 list-decimal">
            <li>
              Resend (resend.com) でアカウントを作成します
            </li>
            <li>
              <strong>送信元ドメインの検証</strong>を行います。Resendの画面に表示されるDNSレコード
              (SPF / DKIM) を sennokuni-wallet.com のDNSへ登録してください。
              この作業をしないとメールはほぼ迷惑メール扱いになるか、そもそも送信できません
            </li>
            <li>Resendの画面でAPIキーを発行します</li>
          </ol>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">設定手順</p>
          <ol className="ml-4 list-decimal">
            <li>APIキー欄に、Resendで発行したキーを貼り付けます</li>
            <li>
              差出人アドレスを、<strong>検証したドメインのアドレス</strong>にします
              (例: no-reply@sennokuni-wallet.com)。検証していないドメインを指定すると送信は失敗します
            </li>
            <li>変更理由を入力して「保存」を押します</li>
            <li>下の「テスト送信」で、ご自身のメールアドレス宛に1通送って届くことを確認します</li>
          </ol>
        </div>
        <p>
          保存後、APIキーは末尾4文字だけのマスク表示になり、元の値は二度と表示されません。
          キーを変更したいときだけ入力してください (空欄で保存すると今のキーが維持されます)。
        </p>
        <p className="text-sengoku-gold-soft">
          テスト送信は<strong>保存済みの設定</strong>で行います。キーを入れ替えたときは、
          先に保存してからテストしてください。テスト送信の実行者と宛先は監査ログに記録されます。
        </p>
      </HelpPanel>

      {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}
      {message && <p className="mb-3 text-sm text-sengoku-green">{message}</p>}

      {config && (
        <div className="mb-4 rounded-lg border border-sengoku-border bg-sengoku-navy-deep p-3 text-xs text-sengoku-muted">
          <p>
            現在のAPIキー:{" "}
            {config.apiKeySet ? (
              <span className="font-mono">{config.apiKeyPreview}</span>
            ) : config.fallbackFromEnv ? (
              <span className="text-sengoku-gold-soft">
                この画面では未設定 (環境変数の値で送信されます)
              </span>
            ) : (
              <span className="text-sengoku-red">未設定 (メールログインは利用できません)</span>
            )}
          </p>
          <p className="mt-1">
            差出人: <span className="font-mono">{config.mailFrom}</span>
          </p>
          {config.updatedAt && (
            <p className="mt-1">
              最終更新: {new Date(config.updatedAt).toLocaleString("ja-JP")}
              {config.updatedBy ? ` (管理者ID: ${config.updatedBy})` : ""}
            </p>
          )}
        </div>
      )}

      <div className="mb-4 space-y-4 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
        <div>
          <label className="block text-xs font-medium text-sengoku-muted">APIキー (Resendで発行)</label>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.apiKeySet ? "変更する場合のみ入力 (空欄なら現状維持)" : "re_..."}
            type="password"
            autoComplete="off"
            className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-sengoku-muted">
            差出人アドレス (検証済みドメインのもの)
          </label>
          <input
            value={mailFrom}
            onChange={(e) => setMailFrom(e.target.value)}
            placeholder="no-reply@sennokuni-wallet.com"
            className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-sengoku-muted">
            変更理由 (監査ログに記録されます)
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: Resendの新しいAPIキーへ更新"
            className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-sengoku-gold px-4 py-1.5 text-sm text-sengoku-navy-deep disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
        <h2 className="text-sm font-semibold">テスト送信</h2>
        <p className="text-xs text-sengoku-muted">
          保存済みの設定で、指定したアドレスへテストメールを1通送ります。
          確認コードは含まれません。
        </p>
        <div>
          <label className="block text-xs font-medium text-sengoku-muted">送信先メールアドレス</label>
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="自分の受信できるアドレス"
            type="email"
            className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={sendTest}
          disabled={testing}
          className="rounded-md border border-sengoku-gold px-4 py-1.5 text-sm text-sengoku-gold disabled:opacity-50"
        >
          {testing ? "送信中..." : "テスト送信"}
        </button>

        {testResult && (
          <div className={`rounded-md p-3 text-xs ${testResultClass}`}>
            <p className="font-semibold">
              {testResult.outcome === "ok" ? "送信しました" : "送信できませんでした"}
            </p>
            <p className="mt-1">{testResult.message}</p>
          </div>
        )}
      </div>
    </>
  );
}
