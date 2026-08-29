"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, ApiError, type CommonUserHubConfig } from "@/lib/api";

/**
 * 代理店システム内共通顧客HUBへの送信設定 (外部開発者向け連携ガイド9章)。
 * `ENABLE_PLATFORM_USER_ID` Feature Flag自体は環境変数のみで変更可能 (他の
 * Feature Flagと同じ方針、`/outbox`画面で確認可能) だが、送信先URL・
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
    <>
        <h1 className="mb-1 text-xl font-bold">共通顧客HUB送信設定</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          代理店システム内共通顧客HUB (外部開発者向け連携ガイド9章) へ、新規アカウント登録時に
          common_user_idを解決するためのAPI送信先です。ここでAPIキーを設定していても、
          Feature Flag「ENABLE_PLATFORM_USER_ID」が無効の間は呼び出されません
          (Flagの状態は「外部連携キュー」画面で確認できます)。
        </p>

        <HelpPanel storageKey="common-user-hub-config" title="このページについて・設定手順">
          <p>
            新しいユーザーがORIウォレットに登録したとき、代理店システム側の「共通顧客HUB」へ
            問い合わせて共通ID(common_user_id)を取得・連携するための接続先設定です。
          </p>
          <div>
            <p className="font-semibold text-sengoku-text">事前に必要なもの</p>
            <p>
              代理店システム(sengoku-ai.com)の担当者から、「AI受信用APIキー」を発行してもらってください。
              これはORI側で作れるものではなく、必ず相手から受け取る必要があります。
            </p>
          </div>
          <div>
            <p className="font-semibold text-sengoku-text">設定手順</p>
            <ol className="ml-4 list-decimal">
              <li>送信先URLは通常初期値のままで問題ありません(代理店システムから変更の指示があった場合のみ変更)</li>
              <li>system_keyも通常は初期値のままで問題ありません</li>
              <li>APIキー欄に、代理店システムから発行されたキーを貼り付け(空欄のまま保存すると今のキーが維持されます)</li>
              <li>変更理由を入力(必須)</li>
              <li>「保存」を押す。保存後、APIキーは末尾4文字だけのマスク表示になり、元の値は二度と表示されません</li>
            </ol>
          </div>
          <p className="text-sengoku-gold-soft">
            注意: ここを設定しただけでは動きません。Feature Flag「ENABLE_PLATFORM_USER_ID」がONになっている必要があります(現在のON/OFFは「外部連携キュー」画面で確認できますが、切り替え自体はエンジニアへの依頼が必要です)。
            URLやAPIキーが間違っていても画面上はエラーになりません(新規登録自体は成功しますが、共通IDの連携だけが静かに失敗します)。設定後は代理店システム側で正しく連携できているか確認してもらってください。
          </p>
        </HelpPanel>

        {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}
        {message && <p className="mb-3 text-sm text-sengoku-green">{message}</p>}

        {config && (
          <div className="mb-4 rounded-lg border border-sengoku-border bg-sengoku-navy-deep p-3 text-xs text-sengoku-muted">
            <p>
              現在の送信用APIキー:{" "}
              {config.apiKeySet ? (
                <span className="font-mono">{config.apiKeyPreview}</span>
              ) : (
                <span className="text-sengoku-gold-soft">未設定 (共通ID解決は動作しません)</span>
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

        <div className="space-y-4 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <div>
            <label className="block text-xs font-medium text-sengoku-muted">送信先URL (base URL)</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://sengoku-ai.com"
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sengoku-muted">system_key (ウォレット自身の識別子)</label>
            <input
              value={systemKey}
              onChange={(e) => setSystemKey(e.target.value)}
              placeholder="ove-wallet"
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sengoku-muted">
              APIキー (代理店システム発行の「AI受信用APIキー」)
            </label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.apiKeySet ? "変更する場合のみ入力 (空欄なら現状維持)" : "未設定"}
              type="password"
              autoComplete="off"
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sengoku-muted">変更理由 (監査ログに記録されます)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: sengoku-ai.comから発行された新しいAPIキーへ更新"
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
      </>  );
}
