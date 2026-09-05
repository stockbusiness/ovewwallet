"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import CollectibleImageCounts from "@/components/CollectibleImageCounts";
import CollectibleImageFailures from "@/components/CollectibleImageFailures";
import HelpPanel from "@/components/HelpPanel";
import {
  apiFetch,
  ApiError,
  type CollectibleImageIngestResult,
  type CollectibleImageIngestStatus,
} from "@/lib/api";

/**
 * カード画像の取り込み状況 (docs/collectible-images.md)。
 *
 * 保管先の設定 (`/image-storage-config`) とは別の画面にしている。設定は滅多に触らない
 * シークレットの管理で、こちらは日々の取り込みが進んでいるかを見るためのもの。
 */
export default function CollectibleImageIngestPage() {
  const router = useRouter();
  const [status, setStatus] = useState<CollectibleImageIngestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CollectibleImageIngestResult | null>(null);
  const [reason, setReason] = useState("");
  const [resetExhausted, setResetExhausted] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(
        await apiFetch<CollectibleImageIngestStatus>("/api/v1/admin/collectible-images/status"),
      );
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

  async function runIngest() {
    if (!reason.trim()) {
      setError("実行理由を入力してください");
      return;
    }
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const ran = await apiFetch<CollectibleImageIngestResult>(
        "/api/v1/admin/collectible-images/ingest",
        {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim(), resetExhausted }),
        },
      );
      setResult(ran);
      setReason("");
      setResetExhausted(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "実行に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">カード画像の取り込み状況</h1>
      <p className="mb-4 text-xs text-sengoku-muted">
        マーケットのカード画像をウォレット側へ取り込んだ結果です。取り込めた画像は
        ウォレットから配信し、取り込めていないものはマーケットのURLをそのまま表示します。
      </p>

      <HelpPanel storageKey="collectible-image-ingest" title="このページについて">
        <div>
          <p className="font-semibold text-sengoku-text">取り込みは15分ごとに動きます</p>
          <p>
            待たずに結果を見たいときは<strong>「今すぐ取り込む」</strong>を押してください。
            1回で扱う枚数と時間には上限があるので、残りは次回以降に持ち越されます
            (押し直す必要はありません)。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">「取り込み対象外」が出ていたら</p>
          <p>
            <strong>保管先を設定する前に登録したカード</strong>の画像です。
            「今すぐ取り込む」を押すか、次の定期実行を待てば対象へ入ります。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">「打ち切り」は自動では戻りません</p>
          <p>
            失敗が続いた画像は、無駄な外部アクセスを繰り返さないために定期実行の対象から
            外れます。取得元の不具合が直ったら
            <strong>「打ち切った分も対象に戻す」</strong>にチェックを入れて実行してください。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">失敗しても付与は止まりません</p>
          <p>
            画像が無いことより、買ったカードを受け取れないことの方が害が大きいためです。
            失敗はここに記録され、後から取り直せます。
          </p>
        </div>
      </HelpPanel>

      {error && <p className="mb-3 rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>}

      {status && !status.configured && (
        <p className="mb-4 rounded bg-yellow-950 p-3 text-sm text-yellow-200">
          保管先が未設定のため、取り込みは動いていません。
          <a href="/image-storage-config" className="ml-1 underline">
            カード画像の保管先
          </a>
          で設定してください。
        </p>
      )}

      {status && <CollectibleImageCounts counts={status.counts} maxAttempts={status.maxAttempts} />}

      <section className="mb-6 rounded border border-sengoku-border p-4">
        <h2 className="mb-2 text-sm font-semibold">今すぐ取り込む</h2>
        <p className="mb-3 text-xs text-sengoku-muted">
          定期実行 (15分ごと) を待たずに1回分走らせます。外部への通信を伴うため、
          1回あたりの枚数と時間に上限があります。
        </p>
        <div className="grid gap-3">
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-muted">実行理由</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="R2を設定したので取りこぼしを取り込む"
              className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-sengoku-muted">
            <input
              type="checkbox"
              checked={resetExhausted}
              onChange={(e) => setResetExhausted(e.target.checked)}
            />
            打ち切った分も対象に戻す (取得元の不具合が直ったとき)
          </label>
        </div>
        <button
          type="button"
          onClick={runIngest}
          disabled={running || (status !== null && !status.configured)}
          className="mt-3 rounded bg-sengoku-accent px-3 py-1 text-sm text-black disabled:opacity-50"
        >
          {running ? "実行中..." : "今すぐ取り込む"}
        </button>
        {result && (
          <p className="mt-3 rounded bg-green-950 p-2 text-sm text-green-300">
            対象へ戻した {result.reset} 件 / 新たに対象へ追加 {result.registered} 件 / 取得を試みた{" "}
            {result.attempted} 件 / 取り込めた {result.stored} 件
          </p>
        )}
      </section>

      {status && <CollectibleImageFailures failures={status.recentFailures} />}
    </>
  );
}
