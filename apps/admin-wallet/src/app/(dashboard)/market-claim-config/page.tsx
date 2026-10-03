"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, ApiError, type MarketClaimConfig } from "@/lib/api";

/**
 * カード受取 (Claim) の接続設定。千ノ国マーケットの受取確認APIを叩くための
 * URL・Key ID・HMAC Secretを登録する。
 *
 * **ここで保存した値は環境変数 `SENGOKU_MARKET_CLAIM_*` より優先される。**
 * 鍵の入れ替えにデプロイを待たせないため (メール送信設定・カード画像の保管先と同じ方針)。
 *
 * Secretは保存すると生値を二度と表示せず、末尾4文字だけのマスク表示になる。
 */
export default function MarketClaimConfigPage() {
  const router = useRouter();
  const [config, setConfig] = useState<MarketClaimConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [keyId, setKeyId] = useState("");
  const [hmacSecret, setHmacSecret] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const current = await apiFetch<MarketClaimConfig>("/api/v1/admin/collectible-claims/config");
      setConfig(current);
      setBaseUrl(current.baseUrl ?? "");
      setKeyId(current.keyId ?? "");
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
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      if (keyId.trim()) body.keyId = keyId.trim();
      if (hmacSecret.trim()) body.hmacSecret = hmacSecret.trim();

      const updated = await apiFetch<MarketClaimConfig>("/api/v1/admin/collectible-claims/config", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setConfig(updated);
      setHmacSecret("");
      setReason("");
      setMessage("保存しました。「カード受取の接続テスト」で疎通を確認してください。");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">カード受取の接続設定</h1>
        <p className="mt-1 text-sm opacity-70">
          千ノ国マーケットの受取確認APIを呼び出すためのURLと署名鍵を登録します。
        </p>
      </div>

      <HelpPanel storageKey="market-claim-config" title="この画面について">
        <div className="space-y-3">
          <div>
            <p className="font-bold">この画面の設定が環境変数より優先されます</p>
            <p>
              環境変数 <code>SENGOKU_MARKET_CLAIM_BASE_URL</code> / <code>_KEY_ID</code> /{" "}
              <code>_HMAC_SECRET</code> でも設定できますが、<strong>ここに3点すべてを登録するとそちらが使われます</strong>。
              鍵の入れ替えにデプロイを待たせないための作りです。
            </p>
          </div>
          <div>
            <p className="font-bold">3点が揃って初めて有効になります</p>
            <p>
              URL・Key ID・Secretのどれか1つでも欠けていると、<strong>この画面の設定は使われず</strong>環境変数へ戻ります。
              URLだけ画面・鍵だけ環境変数という混在を許すと、どちらの組で署名したのか追えなくなるためです。
            </p>
          </div>
          <div>
            <p className="font-bold">Secretは二度と表示されません</p>
            <p>
              保存後は末尾4文字だけのマスク表示になります。<strong>空欄のまま保存すると現在の鍵を維持</strong>するので、
              URLやKey IDだけを直したいときは Secret を空欄にしてください。
            </p>
          </div>
          <div>
            <p className="font-bold">送信方向にご注意ください</p>
            <p>
              ここは<strong>こちらから先方を呼び出す</strong>ための鍵です。先方からイベントを受け取る鍵は
              「共通イベント Signing Key」画面で、別物です。
            </p>
          </div>
        </div>
      </HelpPanel>

      {error && <div className="rounded border border-red-500 bg-red-500/10 p-3 text-sm">{error}</div>}
      {message && <div className="rounded border border-green-500 bg-green-500/10 p-3 text-sm">{message}</div>}

      {config && (
        <div className="rounded border p-4 text-sm">
          <p className="font-bold">現在の状態</p>
          <dl className="mt-2 space-y-1">
            <div>
              <dt className="inline opacity-70">送信に使える状態: </dt>
              <dd className="inline font-bold">{config.configured ? "はい" : "いいえ (未設定)"}</dd>
            </div>
            <div>
              <dt className="inline opacity-70">設定の取得元: </dt>
              <dd className="inline">
                {config.hmacSecretSet
                  ? "この画面"
                  : config.fallbackFromEnv
                    ? "環境変数 (この画面は未設定)"
                    : "未設定"}
              </dd>
            </div>
            <div>
              <dt className="inline opacity-70">HMAC Secret: </dt>
              <dd className="inline">{config.hmacSecretPreview ?? "(この画面には未登録)"}</dd>
            </div>
            {config.updatedAt && (
              <div>
                <dt className="inline opacity-70">最終更新: </dt>
                <dd className="inline">
                  {new Date(config.updatedAt).toLocaleString("ja-JP")}
                  {config.updatedBy ? ` (${config.updatedBy})` : ""}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="space-y-4 rounded border p-4">
        <div>
          <label className="block text-sm font-bold" htmlFor="baseUrl">
            受取確認APIのURL
          </label>
          <input
            id="baseUrl"
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="https://www.sengoku-rr.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="mt-1 text-xs opacity-70">末尾のスラッシュは付けても自動で外します。</p>
        </div>

        <div>
          <label className="block text-sm font-bold" htmlFor="keyId">
            Key ID
          </label>
          <input
            id="keyId"
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="先方から受け取ったKey ID"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-bold" htmlFor="hmacSecret">
            HMAC Secret
          </label>
          <input
            id="hmacSecret"
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="空欄なら現在の鍵を維持します"
            value={hmacSecret}
            onChange={(e) => setHmacSecret(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-bold" htmlFor="reason">
            変更理由
          </label>
          <input
            id="reason"
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="操作ログに残ります"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded border px-4 py-2 disabled:opacity-50"
            disabled={saving}
            onClick={save}
          >
            {saving ? "保存中..." : "保存する"}
          </button>
          <Link className="text-sm underline" href="/collectible-claim-test">
            保存したら接続テストへ
          </Link>
        </div>
      </div>
    </div>
  );
}
