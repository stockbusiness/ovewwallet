"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
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
    <>
        <h1 className="mb-1 text-xl font-bold">共通イベント Signing Key管理</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          外部システム(千ノ国NFTマーケット等)が<code>POST /api/integrations/events</code>
          を送る際のHMAC署名鍵を発行・失効します。secretは発行直後のこの画面でのみ表示され、以後は再表示できません。
          発行後、secret値を連携先システムの担当者へ安全な方法で共有してください。
        </p>

        <HelpPanel storageKey="common-event-signing-keys" title="このページについて・設定手順">
          <p>
            千ノ国NFTマーケットなど外部システムから送られてくる「イベント通知」(例:
            NFTカードの受け渡し完了)を、正しい送信元からのものだと確認するための鍵(secret)を発行する画面です。
            鍵が正しく登録されていないと、外部システムからの通知が全て拒否されます。
          </p>
          <div>
            <p className="font-semibold text-sengoku-text">事前に必要なもの</p>
            <p>連携先(外部システム)の担当者から、以下を確認しておいてください。</p>
            <ul className="ml-4 list-disc">
              <li>その連携先が使う <code>source_system_key</code>(例: 千ノ国NFTマーケットなら <code>sennokuni-nft-market</code>)</li>
              <li>どのイベント種別を送ってくる予定か(例: 商品の受け渡し関連なら entitlement.granted / entitlement.revoked)</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-sengoku-text">発行手順</p>
            <ol className="ml-4 list-decimal">
              <li>key_id に、連携先が実際にヘッダーへ入れてくる値をそのまま入力(担当者に確認した値)</li>
              <li>source_system_key に、連携先を識別する値を入力(担当者に確認した値と完全に一致させる。1文字でも違うと通知は届いても処理が拒否されます)</li>
              <li>secret は「ランダム生成」ボタンで作るのが安全。手入力する場合も他で使っていない値にする</li>
              <li>許可するevent_type は、その連携先から実際に送られてくる種類だけにチェック(不要な種類は許可しないのが安全)</li>
              <li>「発行する」を押す。secretはこの直後の画面にしか表示されないので、必ずこの場でコピーしておく</li>
              <li>発行したsecretを、安全な方法(パスワード管理ツール等。メール本文への直書き等は避ける)で連携先の担当者へ共有する</li>
            </ol>
          </div>
          <div>
            <p className="font-semibold text-sengoku-text">鍵を切り替える(ローテーション)ときの手順</p>
            <p>
              古い鍵をいきなり失効させず、まず新しい鍵を発行 →
              連携先が新しい鍵に切り替えたことを確認 → その後で古い鍵を「失効」してください。
              先に失効すると、連携先が切り替え終わるまでの間、通知が届かなくなります。
            </p>
          </div>
        </HelpPanel>

        {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}

        <div className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-3 text-sm font-semibold">新規発行</h2>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-sengoku-muted">
              key_id (X-SenNoKuni-Key-Idの値)
              <input
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                className="mt-1 w-full rounded border border-sengoku-border p-2 text-sm"
                placeholder="sennokuni-market-stg-001"
              />
            </label>
            <label className="text-xs text-sengoku-muted">
              source_system_key
              <input
                value={sourceSystemKey}
                onChange={(e) => setSourceSystemKey(e.target.value)}
                className="mt-1 w-full rounded border border-sengoku-border p-2 text-sm"
                placeholder="sennokuni-nft-market"
              />
            </label>
          </div>
          <label className="mb-3 block text-xs text-sengoku-muted">
            secret
            <div className="mt-1 flex gap-2">
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="w-full rounded border border-sengoku-border p-2 font-mono text-sm"
                placeholder="発行後は再表示できません"
              />
              <button
                type="button"
                onClick={() => setSecret(generateSecret())}
                className="shrink-0 rounded border border-sengoku-border px-3 text-xs text-sengoku-muted"
              >
                ランダム生成
              </button>
            </div>
          </label>
          <div className="mb-4">
            <p className="mb-1 text-xs text-sengoku-muted">許可するevent_type</p>
            <div className="flex flex-wrap gap-3">
              {COMMON_EVENT_SIGNING_KEY_EVENT_TYPES.map((eventType) => (
                <label key={eventType} className="flex items-center gap-1 text-xs text-sengoku-text">
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
            className="rounded bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
          >
            {submitting ? "発行中..." : "発行する"}
          </button>
        </div>

        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
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
              <tr key={k.id} className="border-t border-sengoku-border">
                <td className="p-3 font-mono">{k.keyId}</td>
                <td className="p-3">{k.sourceSystemKey}</td>
                <td className="p-3 text-xs text-sengoku-muted">{k.allowedEventTypes.join(", ")}</td>
                <td className="p-3">
                  <span className={k.status === "ACTIVE" ? "text-sengoku-green" : "font-semibold text-sengoku-red"}>
                    {k.status}
                  </span>
                </td>
                <td className="p-3">{new Date(k.createdAt).toLocaleString("ja-JP")}</td>
                <td className="p-3">
                  {k.status === "ACTIVE" && (
                    <button onClick={() => revoke(k)} className="text-xs text-sengoku-red underline">
                      失効
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
    </>
  );
}
