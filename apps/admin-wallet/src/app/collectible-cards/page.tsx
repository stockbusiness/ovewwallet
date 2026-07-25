"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type CollectibleAssetItem } from "@/lib/api";

/** NFTコレクション実装指示書14章。カードマスター(CollectibleAsset)の一覧・作成・状態変更。 */
export default function CollectibleCardsPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<CollectibleAssetItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [assetCode, setAssetCode] = useState("");
  const [productCode, setProductCode] = useState("");
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [rarity, setRarity] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<CollectibleAssetItem[]>("/api/v1/admin/collectible/assets");
      setAssets(list);
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

  async function createAsset() {
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/v1/admin/collectible/assets", {
        method: "POST",
        body: JSON.stringify({
          assetCode,
          productCode: productCode || undefined,
          name,
          imageUrl,
          rarity: rarity || undefined,
        }),
      });
      setMessage("カードを作成しました");
      setAssetCode("");
      setProductCode("");
      setName("");
      setImageUrl("");
      setRarity("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "作成に失敗しました");
    }
  }

  async function toggleStatus(asset: CollectibleAssetItem) {
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/collectible/assets/${asset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: asset.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新に失敗しました");
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-1 text-xl font-bold">カードマスター管理</h1>
        <p className="mb-4 text-xs text-neutral-500">
          戦国マーケットで購入されたデジタルカードの見た目(画像・名称・レアリティ等)を登録します。
          画像URLはHTTPSのみ許可され、SVGは拒否されます。
        </p>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">新規カード作成</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              asset_code
              <input
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              product_code
              <input
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              カード名
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              画像URL (https)
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="mt-1 block w-64 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              レアリティ
              <input
                value={rarity}
                onChange={(e) => setRarity(e.target.value)}
                className="mt-1 block w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={createAsset}
              disabled={!assetCode || !name || !imageUrl}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              作成
            </button>
          </div>
          {message && <p className="mt-2 text-sm text-emerald-600">{message}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>

        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">画像</th>
              <th className="p-3">asset_code</th>
              <th className="p-3">カード名</th>
              <th className="p-3">product_code</th>
              <th className="p-3">レアリティ</th>
              <th className="p-3">状態</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id} className="border-t border-neutral-100">
                <td className="p-3">
                  <div className="relative h-12 w-12 overflow-hidden rounded-md bg-neutral-100">
                    <Image src={asset.imageUrl} alt={asset.name} fill sizes="48px" className="object-cover" />
                  </div>
                </td>
                <td className="p-3 font-mono text-xs">{asset.assetCode}</td>
                <td className="p-3">{asset.name}</td>
                <td className="p-3">{asset.productCode ?? "-"}</td>
                <td className="p-3">{asset.rarity ?? "-"}</td>
                <td className="p-3">
                  <span className={asset.status === "ACTIVE" ? "text-emerald-600" : "text-neutral-400"}>{asset.status}</span>
                </td>
                <td className="p-3">
                  <button onClick={() => toggleStatus(asset)} className="text-xs text-brand-600 underline">
                    {asset.status === "ACTIVE" ? "アーカイブ" : "有効化"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
