"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type TransactionItem } from "@/lib/api";

const STATUS_OPTIONS = ["", "COMPLETED", "HELD", "REVERSED", "FAILED"];
const DIRECTION_OPTIONS = ["", "CREDIT", "DEBIT"];

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [accountCode, setAccountCode] = useState("");
  const [status, setStatus] = useState("");
  const [direction, setDirection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (accountCode) params.set("accountCode", accountCode);
      if (status) params.set("status", status);
      if (direction) params.set("direction", direction);
      params.set("limit", "200");
      const list = await apiFetch<TransactionItem[]>(`/api/v1/admin/transactions?${params.toString()}`);
      setTransactions(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push("/login");
      else setError("読み込みに失敗しました");
    }
  }, [router, accountCode, status, direction]);

  useEffect(() => {
    load();
  }, [load]);

  async function reverse(transactionId: string) {
    const reason = window.prompt("取消理由を入力してください");
    if (!reason) return;
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/v1/admin/transactions/${transactionId}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setMessage("取消取引を作成しました");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "取消に失敗しました");
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="mb-4 text-xl font-bold">取引一覧</h1>

        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-3">
          <label className="text-xs">
            アカウントコード
            <input
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              placeholder="OVE-ACC-00000001"
              className="mt-1 block w-48 rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            状態
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 block w-36 rounded-md border border-neutral-300 px-2 py-1 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s || "すべて"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            方向
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="mt-1 block w-32 rounded-md border border-neutral-300 px-2 py-1 text-sm"
            >
              {DIRECTION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d || "すべて"}
                </option>
              ))}
            </select>
          </label>
          <button onClick={load} className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white">
            検索
          </button>
        </div>

        {message && <p className="mb-3 text-sm text-emerald-600">{message}</p>}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">取引コード</th>
              <th className="p-3">アカウント</th>
              <th className="p-3">種別</th>
              <th className="p-3">金額</th>
              <th className="p-3">状態</th>
              <th className="p-3">日時</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100">
                <td className="p-3">{t.transaction_code}</td>
                <td className="p-3">{t.account_code}</td>
                <td className="p-3">{t.display_name}</td>
                <td className="p-3">
                  {t.direction === "CREDIT" ? "+" : "-"}
                  {Number(t.amount).toLocaleString("ja-JP")}
                </td>
                <td className="p-3">{t.status}</td>
                <td className="p-3">{new Date(t.occurred_at).toLocaleString("ja-JP")}</td>
                <td className="p-3">
                  {t.status === "COMPLETED" && (
                    <button onClick={() => reverse(t.id)} className="text-xs text-red-600 underline">
                      取消
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-xs text-neutral-400">
                  該当する取引はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
