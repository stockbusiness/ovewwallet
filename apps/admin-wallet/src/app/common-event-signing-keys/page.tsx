"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, COMMON_EVENT_SIGNING_KEY_EVENT_TYPES, type CommonEventSigningKeyItem } from "@/lib/api";

/** ブラウザのWeb Crypto APIで32byteのランダムHMAC secretを16進文字列として生成する。 */
function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function CommonEventSigningKeysPage() {
  const router = useRouter();
  const [items, setItems] = useState<CommonEventSigningKeyItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [keyId, setKeyId] = useState("");
  const [sourceSystemKey, setSourceSystemKey] = useState("");
  const [secret, setSecret] = useState("");
  const [allowedEventTypes, setAllowedEventTypes] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<CommonEventSigningKeyItem[]>("/api/v1/admin/common-event-signing-keys");
      setItems(list);
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

  function toggleEventType(eventType: string) {
    setAllowedEventTypes((current) =>
      current.includes(eventType) ? current.filter((t) => t !== eventType) : [...current, eventType],
    );
  }

  async function createKey() {
    if (!keyId || !sourceSystemKey || !secret || allowedEventTypes.length === 0) {
      setError("key_id・source_system_key・secret・許可するevent_typeを1つ以上入力してください");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/v1/admin/common-event-signing-keys", {
        method: "POST",
        body: JSON.stringify({ keyId, sourceSystemKey, secret, allowedEventTypes }),
      });
      setKeyId("");
      setSourceSystemKey("");
      setSecret("");
      setAllowedEventTypes([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "発行に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(target: CommonEventSigningKeyItem) {
    if (!window.confirm(`key_id "${target.keyId}" を失効させます。よろしいですか?`)) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/common-event-signing-keys/${target.keyId}/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失効に失敗しました");
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-1 text-xl font-bold">共通イベント Signing Key管理</h1>
        <p className="mb-4 text-xs text-neutral-500">
          外部システム(千ノ国NFTマーケット等)が<code>POST /api/integrations/events</code>
          を送る際のHMAC署名鍵を発行・失効します。secretは発行直後のこの画面でのみ表示され、以後は再表示できません。
          発行後、secret値を連携先システムの担当者へ安全な方法で共有してください。
        </p>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">新規発行</h2>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-neutral-500">
              key_id (X-SenNoKuni-Key-Idの値)
              <input
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm"
                placeholder="sennokuni-market-stg-001"
              />
            </label>
            <label className="text-xs text-neutral-500">
              source_system_key
              <input
                value={sourceSystemKey}
                onChange={(e) => setSourceSystemKey(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm"
                placeholder="sennokuni-nft-market"
              />
            </label>
          </div>
          <label className="mb-3 block text-xs text-neutral-500">
            secret
            <div className="mt-1 flex gap-2">
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="w-full rounded border border-neutral-300 p-2 font-mono text-sm"
                placeholder="発行後は再表示できません"
              />
              <button
                type="button"
                onClick={() => setSecret(generateSecret())}
                className="shrink-0 rounded border border-neutral-300 px-3 text-xs text-neutral-600"
              >
                ランダム生成
              </button>
            </div>
          </label>
          <div className="mb-4">
            <p className="mb-1 text-xs text-neutral-500">許可するevent_type</p>
            <div className="flex flex-wrap gap-3">
              {COMMON_EVENT_SIGNING_KEY_EVENT_TYPES.map((eventType) => (
                <label key={eventType} className="flex items-center gap-1 text-xs text-neutral-700">
                  <input
                    type="checkbox"
                    checked={allowedEventTypes.includes(eventType)}
                    onChange={() => toggleEventType(eventType)}
                  />
                  {eventType}
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={createKey}
            disabled={submitting}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "発行中..." : "発行する"}
          </button>
        </div>

        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">key_id</th>
              <th className="p-3">source_system_key</th>
              <th className="p-3">許可event_type</th>
              <th className="p-3">状態</th>
              <th className="p-3">発行日時</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((k) => (
              <tr key={k.id} className="border-t border-neutral-100">
                <td className="p-3 font-mono">{k.keyId}</td>
                <td className="p-3">{k.sourceSystemKey}</td>
                <td className="p-3 text-xs text-neutral-500">{k.allowedEventTypes.join(", ")}</td>
                <td className="p-3">
                  <span className={k.status === "ACTIVE" ? "text-emerald-600" : "font-semibold text-red-600"}>
                    {k.status}
                  </span>
                </td>
                <td className="p-3">{new Date(k.createdAt).toLocaleString("ja-JP")}</td>
                <td className="p-3">
                  {k.status === "ACTIVE" && (
                    <button onClick={() => revoke(k)} className="text-xs text-red-600 underline">
                      失効
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
