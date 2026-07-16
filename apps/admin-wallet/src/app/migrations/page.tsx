"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type AccountListItem } from "@/lib/api";

interface MigrationRequestResult {
  result: "PENDING_APPROVAL";
  approvalRequestId: string;
}

export default function MigrationsPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [batchName, setBatchName] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<MigrationRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewingAccounts, setReviewingAccounts] = useState<AccountListItem[]>([]);

  const loadReviewingAccounts = useCallback(async () => {
    try {
      const list = await apiFetch<AccountListItem[]>("/api/v1/admin/accounts?status=REVIEWING&limit=200");
      setReviewingAccounts(list);
    } catch {
      // ログイン切れ等はページ本体のAPI呼び出し側で処理されるため、ここでは静かに無視する
    }
  }, []);

  useEffect(() => {
    loadReviewingAccounts();
  }, [loadReviewingAccounts]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setCsvContent(String(reader.result));
    reader.readAsText(file, "utf-8");
  }

  async function requestExecution() {
    if (!csvContent || !fileName || !batchName || !reason) return;
    setError(null);
    try {
      const res = await apiFetch<MigrationRequestResult>("/api/v1/admin/migrations/request", {
        method: "POST",
        body: JSON.stringify({ fileName, csvContent, batchName, reason }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "申請に失敗しました");
    }
  }

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-1 text-xl font-bold">既存ユーザー移行</h1>
        <p className="mb-4 text-xs text-neutral-500">
          形式: old_user_id,old_balance (old_balance を空欄にすると「残高不明」として扱われ、
          推定値を入れずアカウントは REVIEWING 状態になります)。移行の実行は事前承認制であり、
          ここでの申請だけでは実行されません。申請者本人以外の管理者が
          「二段階承認」画面でCSVの内容を確認し承認した時点で初めて実行されます。
        </p>

        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs">
              バッチ名
              <input
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                className="ml-2 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                placeholder="2026年7月度移行"
              />
            </label>
            <input type="file" accept=".csv,text/csv" onChange={onFileChange} className="text-sm" />
          </div>
          <label className="block text-xs">
            申請理由
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="ml-2 w-96 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              placeholder="旧システム終了に伴う移行 (2026年7月分)"
            />
          </label>
          <button
            onClick={requestExecution}
            disabled={!csvContent || !batchName || !reason}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            承認を申請
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {result && (
          <section className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
            承認待ちとして申請しました。
            <Link href="/approval-requests" className="ml-1 underline">
              「二段階承認」画面
            </Link>
            で別の管理者が承認すると実行されます。
          </section>
        )}

        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-1 text-sm font-semibold text-amber-800">
            検証待ちアカウント (REVIEWING) — {reviewingAccounts.length}件
          </h2>
          <p className="mb-3 text-xs text-amber-700">
            残高不明のまま移行されたアカウント。検証者が旧システム側の記録などで残高を調査し、
            各アカウントの詳細画面から確認済み残高を入力して解消してください。
          </p>
          {reviewingAccounts.length === 0 ? (
            <p className="text-xs text-neutral-500">検証待ちのアカウントはありません</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pb-1">アカウントコード</th>
                  <th className="pb-1">メール</th>
                  <th className="pb-1">登録日</th>
                  <th className="pb-1"></th>
                </tr>
              </thead>
              <tbody>
                {reviewingAccounts.map((a) => (
                  <tr key={a.id} className="border-t border-amber-100">
                    <td className="py-1">{a.accountCode}</td>
                    <td className="py-1">{a.primaryEmail ?? "-"}</td>
                    <td className="py-1">{new Date(a.createdAt).toLocaleDateString("ja-JP")}</td>
                    <td className="py-1">
                      <Link href={`/accounts/${a.id}`} className="text-brand-600 underline">
                        検証する
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
