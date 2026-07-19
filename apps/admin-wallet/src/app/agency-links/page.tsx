"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type AgencyLinkItem } from "@/lib/api";

const STATUS_LABEL: Record<AgencyLinkItem["status"], string> = {
  PENDING: "未紐付け(同期のみ)",
  ACTIVE: "紐付け済み",
  REVOKED: "解除済み",
};

const STATUS_CLASS: Record<AgencyLinkItem["status"], string> = {
  PENDING: "text-amber-600",
  ACTIVE: "text-emerald-600",
  REVOKED: "text-neutral-400",
};

function metaString(metadata: Record<string, unknown> | null, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : "-";
}

export default function AgencyLinksPage() {
  const router = useRouter();
  const [items, setItems] = useState<AgencyLinkItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = statusFilter ? `?status=${statusFilter}` : "";
      const list = await apiFetch<AgencyLinkItem[]>(`/api/v1/admin/agency-links${query}`);
      setItems(list);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }, [router, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="mb-1 text-xl font-bold">代理店連携状態一覧</h1>
        <p className="mb-4 text-xs text-neutral-500">
          戦国経済圏代理店システム (sengoku-ai.com) から受信した同期データと、SSOログインによる
          OVEアカウントとの紐付け状態。「未紐付け」は同期のみ受信済みで、まだSSOログインが
          行われていない状態 (詳細は docs/agency-integration.md 参照)。
        </p>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor="statusFilter">状態:</label>
          <select
            id="statusFilter"
            className="rounded border border-neutral-300 px-2 py-1"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">すべて</option>
            <option value="PENDING">未紐付け(同期のみ)</option>
            <option value="ACTIVE">紐付け済み</option>
            <option value="REVOKED">解除済み</option>
          </select>
        </div>

        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">external_id</th>
              <th className="p-3">状態</th>
              <th className="p-3">紐付けOVEアカウント</th>
              <th className="p-3">代理店名</th>
              <th className="p-3">連絡先メール</th>
              <th className="p-3">同期/認証日時</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr className="border-t border-neutral-100 align-top">
                  <td className="p-3">{item.externalUserId}</td>
                  <td className="p-3">
                    <span className={STATUS_CLASS[item.status]}>{STATUS_LABEL[item.status]}</span>
                  </td>
                  <td className="p-3">
                    {item.account ? `${item.account.accountCode} (${item.account.displayName ?? "-"})` : "-"}
                  </td>
                  <td className="p-3">{metaString(item.metadata, "name")}</td>
                  <td className="p-3">{metaString(item.metadata, "contactEmail")}</td>
                  <td className="p-3">
                    {new Date(item.verifiedAt ?? item.linkedAt).toLocaleString("ja-JP")}
                  </td>
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
                    <td colSpan={7} className="p-3">
                      <dl className="grid grid-cols-2 gap-2 text-xs text-neutral-600 sm:grid-cols-3">
                        <div>
                          <dt className="text-neutral-400">親代理店ID (parent_external_id)</dt>
                          <dd>{metaString(item.metadata, "parentExternalId")}</dd>
                        </div>
                        <div>
                          <dt className="text-neutral-400">共通ID (common_user_id)</dt>
                          <dd>{metaString(item.metadata, "commonUserId")}</dd>
                        </div>
                        <div>
                          <dt className="text-neutral-400">紹介トークン (referral_token)</dt>
                          <dd>{metaString(item.metadata, "referralToken")}</dd>
                        </div>
                        <div>
                          <dt className="text-neutral-400">ロール</dt>
                          <dd>{metaString(item.metadata, "roleLabel")}</dd>
                        </div>
                        <div>
                          <dt className="text-neutral-400">同期ステータス (status)</dt>
                          <dd>{metaString(item.metadata, "syncStatus")}</dd>
                        </div>
                        <div>
                          <dt className="text-neutral-400">連携方法 (linkMethod)</dt>
                          <dd>{item.linkMethod}</dd>
                        </div>
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-neutral-400">
                  該当する連携はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
