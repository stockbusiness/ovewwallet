"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type CommonUserHubConfig } from "@/lib/api";

/**
 * 代理店システム内共通顧客HUBへの送信設定 (外部開発者向け連携ガイド9章)。
 * `ENABLE_PLATFORM_USER_ID` Feature Flag自体は環境変数のみで変更可能 (他の
 * Feature Flagと同じ方針、`/security`画面で確認可能) だが、送信先URL・
 * system_key・APIキーはここから編集できる。APIキーは一度保存すると生値を
 * 二度と表示せず、末尾4文字のみのマスク表示になる。
 */
export default function CommonUserHubConfigPage() {
  const router = useRouter();
  const [config, setConfig] = useState<CommonUserHubConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [systemKey, setSystemKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const current = await apiFetch<CommonUserHubConfig>("/api/v1/admin/common-user-hub-config");
      setConfig(current);
      setBaseUrl(current.baseUrl);
      setSystemKey(current.systemKey);
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
      const body: Record<string, string> = { baseUrl, systemKey, reason };
      if (apiKey.trim()) body.apiKey = apiKey.trim();

      const updated = await apiFetch<CommonUserHubConfig>("/api/v1/admin/common-user-hub-config", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setConfig(updated);
      setApiKey("");
      setReason("");
      setMessage("保存しました");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-1 text-xl font-bold">共通顧客HUB送信設定</h1>
        <p className="mb-4 text-xs text-neutral-500">
          代理店システム内共通顧客HUB (外部開発者向け連携ガイド9章) へ、新規アカウント登録時に
          common_user_idを解決するためのAPI送信先です。ここでAPIキーを設定していても、
          Feature Flag「ENABLE_PLATFORM_USER_ID」が無効の間は呼び出されません
          (Flagの状態は「セキュリティ設定」画面で確認できます)。
        </p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {message && <p className="mb-3 text-sm text-emerald-600">{message}</p>}

        {config && (
          <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            <p>
              現在の送信用APIキー:{" "}
              {config.apiKeySet ? (
                <span className="font-mono">{config.apiKeyPreview}</span>
              ) : (
                <span className="text-amber-600">未設定 (共通ID解決は動作しません)</span>
              )}
            </p>
            {config.updatedAt && (
              <p className="mt-1">
                最終更新: {new Date(config.updatedAt).toLocaleString("ja-JP")}
                {config.updatedBy ? ` (管理者ID: ${config.updatedBy})` : ""}
              </p>
            )}
          </div>
        )}

        <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600">送信先URL (base URL)</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://sengoku-ai.com"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600">system_key (ウォレット自身の識別子)</label>
            <input
              value={systemKey}
              onChange={(e) => setSystemKey(e.target.value)}
              placeholder="ove-wallet"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600">
              APIキー (代理店システム発行の「AI受信用APIキー」)
            </label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.apiKeySet ? "変更する場合のみ入力 (空欄なら現状維持)" : "未設定"}
              type="password"
              autoComplete="off"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600">変更理由 (監査ログに記録されます)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: sengoku-ai.comから発行された新しいAPIキーへ更新"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </main>
    </div>
  );
}
