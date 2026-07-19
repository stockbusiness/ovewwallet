"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type ApprovalRequestItem, type MigrationSummary } from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  HIGH_VALUE_GRANT: "高額付与",
  HIGH_VALUE_DEDUCTION: "高額減算",
  ACCOUNT_MERGE: "アカウント統合",
  MIGRATION_EXECUTION: "既存ユーザー移行の実行",
};

function formatDetail(r: ApprovalRequestItem): string {
  if (r.payload.kind === "ACCOUNT_MERGE") {
    return `${r.payload.sourceAccountCode} → ${r.payload.targetAccountCode}`;
  }
  if (r.payload.kind === "MIGRATION_EXECUTION") {
    return `${r.payload.batchName} (${r.payload.fileName})`;
  }
  return `${Number(r.payload.amount).toLocaleString("ja-JP")} OVE`;
}

/** 承認待ちがこの時間を超えて放置されている場合、強調表示する (SLA可視化)。 */
const SLA_HOURS = 24;

function elapsedSinceRequested(requestedAt: string): { label: string; overSla: boolean } {
  const hours = (Date.now() - new Date(requestedAt).getTime()) / (60 * 60 * 1000);
  const label = hours < 1 ? "1時間未満" : hours < 24 ? `${Math.floor(hours)}時間` : `${Math.floor(hours / 24)}日`;
  return { label, overSla: hours >= SLA_HOURS };
}

export default function ApprovalRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ApprovalRequestItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [migrationResult, setMigrationResult] = useState<MigrationSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<ApprovalRequestItem[]>("/api/v1/admin/approval-requests");
      setRequests(list);
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

  async function approve(id: string, requestType: string) {
    setError(null);
    setMigrationResult(null);
    try {
      const result = await apiFetch<unknown>(`/api/v1/admin/approval-requests/${id}/approve`, { method: "POST" });
      if (requestType === "MIGRATION_EXECUTION") {
        setMigrationResult(result as MigrationSummary);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "承認に失敗しました");
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("却下理由を入力してください");
    if (!reason) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/approval-requests/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "却下に失敗しました");
    }
  }

  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-1 text-xl font-bold">二段階承認</h1>
        <p className="mb-4 text-xs text-neutral-500">
          高額付与・高額減算 (指示書13章のしきい値以上)、アカウント統合、既存ユーザー移行の実行
          (いずれも金額によらず常に対象) は、申請者本人以外の管理者が承認するまで実行されません。
        </p>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {migrationResult && (
          <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold">移行実行結果 (バッチ: {migrationResult.batchId})</span>
              <button
                onClick={() => setMigrationResult(null)}
                className="text-xs text-neutral-500 underline"
              >
                閉じる
              </button>
            </div>
            <p className="text-xs text-neutral-600">
              合計 {migrationResult.totalCount}件 / 成功 {migrationResult.successCount}件 / 要確認{" "}
              {migrationResult.reviewingCount}件 / エラー {migrationResult.errorCount}件
            </p>
            {migrationResult.errorCount > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-red-600">
                {migrationResult.results
                  .filter((r) => r.status === "ERROR")
                  .map((r) => (
                    <li key={r.row}>
                      行{r.row} ({r.oldUserId}): {r.message}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        <h2 className="mb-2 text-sm font-semibold">承認待ち ({pending.length})</h2>
        <table className="mb-6 w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">種別</th>
              <th className="p-3">内容</th>
              <th className="p-3">理由</th>
              <th className="p-3">申請者</th>
              <th className="p-3">申請日時</th>
              <th className="p-3">経過時間</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((r) => {
              const elapsed = elapsedSinceRequested(r.requestedAt);
              return (
                <tr key={r.id} className={`border-t border-neutral-100 ${elapsed.overSla ? "bg-red-50" : ""}`}>
                  <td className="p-3">{KIND_LABEL[r.payload.kind] ?? r.requestType}</td>
                  <td className="p-3">{formatDetail(r)}</td>
                  <td className="p-3">{r.payload.reason}</td>
                  <td className="p-3 font-mono text-xs">{r.requestedBy}</td>
                  <td className="p-3">{new Date(r.requestedAt).toLocaleString("ja-JP")}</td>
                  <td className="p-3">
                    <span className={elapsed.overSla ? "font-bold text-red-600" : "text-neutral-600"}>
                      {elapsed.label}
                      {elapsed.overSla && " (放置)"}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => approve(r.id, r.requestType)} className="text-xs text-brand-600 underline">
                        承認
                      </button>
                      <button onClick={() => reject(r.id)} className="text-xs text-red-600 underline">
                        却下
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pending.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-xs text-neutral-400">
                  承認待ちの申請はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h2 className="mb-2 text-sm font-semibold">履歴</h2>
        <table className="w-full rounded-lg border border-neutral-200 bg-white text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="p-3">種別</th>
              <th className="p-3">内容</th>
              <th className="p-3">状態</th>
              <th className="p-3">承認/却下者</th>
              <th className="p-3">日時</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="p-3">{KIND_LABEL[r.payload.kind] ?? r.requestType}</td>
                <td className="p-3">{formatDetail(r)}</td>
                <td className="p-3">
                  <span className={r.status === "APPROVED" ? "text-emerald-600" : "text-red-600"}>{r.status}</span>
                </td>
                <td className="p-3 font-mono text-xs">{r.approvedBy ?? "-"}</td>
                <td className="p-3">{r.decidedAt ? new Date(r.decidedAt).toLocaleString("ja-JP") : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
