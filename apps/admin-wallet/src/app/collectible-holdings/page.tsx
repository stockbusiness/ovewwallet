"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type CollectibleHoldingItem, type CollectibleHoldingStatus } from "@/lib/api";

const STATUS_OPTIONS: Array<CollectibleHoldingStatus | ""> = [
  "",
  "ACTIVE",
  "REVOKED",
  "MINT_READY",
  "MINTING",
  "ONCHAIN",
  "TRANSFERRED",
  "BURNED",
  "ERROR",
];

/** NFTコレクション実装指示書14章。common_user_id/account_code/entitlement_id等で保有を検索する。 */
export default function CollectibleHoldingsPage() {
  const router = useRouter();
  const [items, setItems] = useState<CollectibleHoldingItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [commonUserId, setCommonUserId] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [entitlementId, setEntitlementId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [productCode, setProductCode] = useState("");
  const [status, setStatus] = useState<CollectibleHoldingStatus | "">("");

  async function search() {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (commonUserId) params.set("common_user_id", commonUserId);
      if (accountCode) params.set("account_code", accountCode);
      if (entitlementId) params.set("entitlement_id", entitlementId);
      if (orderId) params.set("order_id", orderId);
      if (productCode) params.set("product_code", productCode);
      if (status) params.set("status", status);
      const list = await apiFetch<CollectibleHoldingItem[]>(`/api/v1/admin/collectible/holdings?${params.toString()}`);
      setItems(list);
      setSearched(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "検索に失敗しました");
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-1 text-xl font-bold">カード保有一覧</h1>
        <p className="mb-4 text-xs text-neutral-500">
          利用者からの問い合わせ対応・不正利用調査向けの検索画面です。条件を1つ以上指定してください。
        </p>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              common_user_id
              <input
                value={commonUserId}
                onChange={(e) => setCommonUserId(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              account_code
              <input
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              entitlement_id
              <input
                value={entitlementId}
                onChange={(e) => setEntitlementId(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              order_id
              <input
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              product_code
              <input
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                className="mt-1 block w-32 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              状態
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as CollectibleHoldingStatus | "")}
                className="mt-1 block w-32 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s || "すべて"}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={search} className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white">
              検索
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>

        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">カード名</th>
              <th className="p-3">保有アカウント</th>
              <th className="p-3">entitlement_id</th>
              <th className="p-3">取得日</th>
              <th className="p-3">状態</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id} className="border-t border-neutral-100">
                <td className="p-3">{h.asset.name}</td>
                <td className="p-3 font-mono text-xs">{h.account?.accountCode ?? h.oveAccountId}</td>
                <td className="p-3 font-mono text-xs">{h.entitlementId}</td>
                <td className="p-3">{new Date(h.acquiredAt).toLocaleString("ja-JP")}</td>
                <td className="p-3">
                  <span className={h.status === "ACTIVE" ? "text-emerald-600" : "text-neutral-400"}>{h.status}</span>
                </td>
                <td className="p-3">
                  <Link href={`/collectible-holdings/${h.id}`} className="text-xs text-brand-600 underline">
                    詳細
                  </Link>
                </td>
              </tr>
            ))}
            {searched && items.length === 0 && (
              <tr>
                <td className="p-3 text-xs text-neutral-400" colSpan={6}>
                  該当する保有が見つかりません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
