"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import ImageStorageStatus from "@/components/ImageStorageStatus";
import { apiFetch, ApiError, type ImageStorageConfig, type ImageStorageTestResult } from "@/lib/api";

/**
 * カード画像の保管先設定 (docs/collectible-images.md)。
 *
 * シークレットは一度保存すると生値を二度と表示せず、末尾4文字だけのマスク表示になる
 * (メール送信設定と同じ)。接続テストは**保存済みの設定**で行うので、先に保存してから試す。
 */
export default function ImageStorageConfigPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ImageStorageConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [bucket, setBucket] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [reason, setReason] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ImageStorageTestResult | null>(null);

  const load = useCallback(async () => {
    try {
      const current = await apiFetch<ImageStorageConfig>("/api/v1/admin/image-storage-config");
      setConfig(current);
      setBucket(current.bucket ?? "");
      setEndpoint(current.endpoint ?? "");
      setRegion(current.region);
      setAccessKeyId(current.accessKeyId ?? "");
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
    setTestResult(null);
    setSaving(true);
    try {
      const updated = await apiFetch<ImageStorageConfig>("/api/v1/admin/image-storage-config", {
        method: "POST",
        body: JSON.stringify({
          bucket,
          endpoint,
          region,
          accessKeyId,
          // 空欄なら送らない。現在のシークレットを維持するため。
          ...(secretAccessKey ? { secretAccessKey } : {}),
          reason: reason.trim(),
        }),
      });
      setConfig(updated);
      setSecretAccessKey("");
      setReason("");
      setMessage("保存しました");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setError(null);
    setMessage(null);
    setTesting(true);
    try {
      setTestResult(
        await apiFetch<ImageStorageTestResult>("/api/v1/admin/image-storage-config/test", {
          method: "POST",
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "接続テストに失敗しました");
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">カード画像の保管先</h1>
      <p className="mb-4 text-xs text-sengoku-muted">
        NFTコレクションのカード画像を、ウォレット側へ取り込んで配信するための設定です。
        設定するまでは取り込みを行わず、マーケットのURLをそのまま表示します。
      </p>

      <HelpPanel storageKey="image-storage-config" title="このページについて">
        <div>
          <p className="font-semibold text-sengoku-text">なぜ画像を持つのか</p>
          <p>
            画像のURLだけを預かっていると、<strong>マーケット側の配信が止まった時点で、
            お客様が買ったカードの絵柄が見えなくなります。</strong>
            保有の記録はウォレットにあるので、見た目も自前で持ちます。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">Cloudflare R2 / Amazon S3 に対応しています</p>
          <p>
            R2 の場合は<strong>エンドポイント</strong>の入力が必要です (S3 なら空欄で構いません)。
            リージョンは R2 では使われないため <code>auto</code> のままで動きます。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">シークレットは保存後に表示されません</p>
          <p>
            末尾4文字だけのマスク表示になります。変更するときだけ入力してください。
            <strong>空欄で保存しても現在の値は消えません。</strong>
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">接続テストは実際に書き込みます</p>
          <p>
            一覧の取得だけでは書き込み権限があるか分かりません。固定の名前のファイルを1つ
            書いて読み戻します (毎回上書きするので増えません)。
            <strong>保存済みの設定で試すので、先に保存してください。</strong>
          </p>
        </div>
      </HelpPanel>

      {error && <p className="mb-3 rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>}
      {message && <p className="mb-3 rounded bg-green-950 p-2 text-sm text-green-300">{message}</p>}

      {config && <ImageStorageStatus config={config} />}

      <section className="mb-6 rounded border border-sengoku-border p-4">
        <h2 className="mb-3 text-sm font-semibold">設定</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-muted">バケット名</span>
            <input
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              placeholder="sennokuni-collectible-images"
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-muted">エンドポイント (R2のみ)</span>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://<アカウントID>.r2.cloudflarestorage.com"
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-muted">リージョン</span>
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="auto"
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-muted">アクセスキーID</span>
            <input
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="mb-1 block text-sengoku-muted">
              シークレットアクセスキー (変更するときだけ入力)
            </span>
            <input
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              autoComplete="new-password"
              placeholder={config?.secretAccessKeySet ? "変更しない場合は空欄のまま" : ""}
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="mb-1 block text-sengoku-muted">変更理由</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="R2バケットを新規作成したため"
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-3 rounded bg-sengoku-accent px-3 py-1 text-sm text-black disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </section>

      <section className="rounded border border-sengoku-border p-4">
        <h2 className="mb-2 text-sm font-semibold">接続テスト</h2>
        <p className="mb-3 text-xs text-sengoku-muted">
          保存済みの設定で、テスト用のファイルを1つ書き込んで読み戻します。
        </p>
        <button
          type="button"
          onClick={runTest}
          disabled={testing}
          className="rounded border border-sengoku-border px-3 py-1 text-sm disabled:opacity-50"
        >
          {testing ? "実行中..." : "接続テストを実行"}
        </button>
        {testResult && (
          <p
            className={`mt-3 rounded p-2 text-sm ${
              testResult.outcome === "ok"
                ? "bg-green-950 text-green-300"
                : "bg-red-950 text-red-300"
            }`}
          >
            {testResult.outcome === "ok" ? "成功: " : "失敗: "}
            {testResult.message}
            {testResult.bucket && (
              <span className="ml-1 text-xs opacity-80">(バケット: {testResult.bucket})</span>
            )}
          </p>
        )}
      </section>
    </>
  );
}
