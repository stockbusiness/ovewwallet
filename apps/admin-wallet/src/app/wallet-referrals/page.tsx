"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type WalletReferralItem } from "@/lib/api";

const STATUS_LABEL: Record<WalletReferralItem["status"], string> = {
  CAPTURED: "受付済み(登録前)",
  PENDING: "登録済み・確認待ち",
  CONFIRMED: "紹介関係確定",
  REJECTED: "否認",
  MANUALLY_CONFIRMED: "管理者による手動確定",
  CANCELLED: "取消",
  ERROR: "エラー",
  EXPIRED: "期限切れ",
};

const STATUS_CLASS: Record<WalletReferralItem["status"], string> = {
  CAPTURED: "text-neutral-500",
  PENDING: "text-amber-600",
  CONFIRMED: "text-emerald-600",
  REJECTED: "text-red-600",
  MANUALLY_CONFIRMED: "text-emerald-600",
  CANCELLED: "text-neutral-400",
  ERROR: "text-red-600",
  EXPIRED: "text-neutral-400",
};

export default function WalletReferralsPage() {
  const router = useRouter();
  const [items, setItems] = useState<WalletReferralItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = statusFilter ? `?status=${statusFilter}` : "";
      const list = await apiFetch<WalletReferralItem[]>(`/api/v1/admin/wallet-referrals${query}`);
      setItems(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push("/login");
      else setError(err instanceof ApiError ? err.message : "取得に失敗しました");
    }
  }, [router, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="mb-1 text-xl font-bold">代理店紹介トークン受け入れ</h1>
        <p className="mb-4 text-xs text-neutral-500">
          代理店紹介URL (<code>/invite/&#123;token&#125;</code>) 経由の受付・新規登録時の紐付け・
          初回登録特典3,000 OVEの状態を確認する画面 (Phase 1: 確認のみ。手動確定・取消はPhase 3で追加)。
        </p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor="statusFilter">状態:</label>
          <select
            id="statusFilter"
            className="rounded border border-neutral-300 px-2 py-1"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">すべて</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">状態</th>
              <th className="p-3">登録OVEアカウント</th>
              <th className="p-3">代理店ID</th>
              <th className="p-3">登録特典</th>
              <th className="p-3">受付日時</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const benefit = item.benefits[0];
              return (
                <Fragment key={item.id}>
                  <tr className="border-t border-neutral-100 align-top">
                    <td className="p-3">
                      <span className={STATUS_CLASS[item.status]}>{STATUS_LABEL[item.status]}</span>
                    </td>
                    <td className="p-3">
                      {item.account ? `${item.account.accountCode} (${item.account.displayName ?? "-"})` : "-"}
                    </td>
                    <td className="p-3">{item.agencyId ?? "-"}</td>
                    <td className="p-3">
                      {benefit ? `${Number(benefit.amount).toLocaleString("ja-JP")} OVE (${benefit.status})` : "-"}
                    </td>
                    <td className="p-3">{new Date(item.capturedAt).toLocaleString("ja-JP")}</td>
                    <td className="p-3">
                      <button
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        className="text-xs text-brand-600 underline"
                      >
                        {expandedId === item.id ? "閉じる" : "詳細"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr className="border-t border-neutral-100 bg-neutral-50">
                      <td colSpan={6} className="p-3">
                        <dl className="grid grid-cols-2 gap-2 text-xs text-neutral-600 sm:grid-cols-3">
                          <div>
                            <dt className="text-neutral-400">受付元 (source)</dt>
                            <dd>{item.source}</dd>
                          </div>
                          <div>
                            <dt className="text-neutral-400">有効期限 (expires_at)</dt>
                            <dd>{new Date(item.expiresAt).toLocaleString("ja-JP")}</dd>
                          </div>
                          <div>
                            <dt className="text-neutral-400">登録日時</dt>
                            <dd>{item.registeredAt ? new Date(item.registeredAt).toLocaleString("ja-JP") : "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-neutral-400">代理店ランク</dt>
                            <dd>{item.agencyRank ?? "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-neutral-400">最終エラー</dt>
                            <dd>{item.lastErrorMessage ?? "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-neutral-400">備考</dt>
                            <dd>{item.reason ?? "-"}</dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-neutral-400">
                  該当する紹介はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
