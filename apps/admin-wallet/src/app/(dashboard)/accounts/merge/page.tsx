"use client";

import { toStoredCode } from "@ove/shared-ui";
import Link from "next/link";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

interface MergeRequestResult {
  result: "PENDING_APPROVAL";
  approvalRequestId: string;
}

export default function AccountMergePage() {
  const [sourceAccountCode, setSourceAccountCode] = useState("");
  const [targetAccountCode, setTargetAccountCode] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<MergeRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function submit() {
    if (!sourceAccountCode || !targetAccountCode || !reason) return;
    setError(null);
    try {
      const res = await apiFetch<MergeRequestResult>("/api/v1/admin/accounts/merge", {
        method: "POST",
        body: JSON.stringify({
          sourceAccountCode: toStoredCode(sourceAccountCode),
          targetAccountCode: toStoredCode(targetAccountCode),
          reason,
        }),
      });
      setResult(res);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "統合の申請に失敗しました");
      setConfirming(false);
    }
  }

  return (
    <>
        <Link href="/accounts" className="text-sm text-sengoku-gold">
          ← アカウント一覧
        </Link>
        <h1 className="mb-1 mt-2 text-xl font-bold">アカウント統合</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          統合元 (source) のウォレット残高・連携情報はすべて統合先 (target) へ移管され、
          統合元アカウントは MERGED 状態になりログインできなくなります。取り消せない操作の
          ため、金額によらず必ず二段階承認 (申請者本人以外の管理者による承認) が必要です。
          この画面での送信は「申請」であり、承認されるまで統合は実行されません。
        </p>

        <div className="flex flex-col gap-3 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <label className="text-xs">
            統合元アカウントコード (このアカウントが消滅します)
            <input
              value={sourceAccountCode}
              onChange={(e) => setSourceAccountCode(e.target.value)}
              placeholder="ORI-ACC-00000001"
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            統合先アカウントコード (残高を引き継ぐアカウント)
            <input
              value={targetAccountCode}
              onChange={(e) => setTargetAccountCode(e.target.value)}
              placeholder="ORI-ACC-00000002"
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            理由
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </label>

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={!sourceAccountCode || !targetAccountCode || !reason}
              className="rounded-md bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
            >
              内容を確認する
            </button>
          ) : (
            <div className="rounded-md border border-sengoku-red/30 bg-sengoku-red/10 p-3">
              <p className="mb-2 text-sm text-sengoku-red">
                {sourceAccountCode} を {targetAccountCode} へ統合する申請を送信しますか?
                (別の管理者の承認後に実行されます)
              </p>
              <div className="flex gap-2">
                <button onClick={submit} className="rounded-md bg-sengoku-red px-3 py-1.5 text-sm text-white">
                  申請する
                </button>
                <button onClick={() => setConfirming(false)} className="rounded-md border px-3 py-1.5 text-sm">
                  やめる
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-sengoku-red">{error}</p>}
        {result && (
          <p className="mt-3 rounded-md bg-sengoku-green/10 p-3 text-sm text-sengoku-green">
            統合の申請を送信しました。
            <Link href="/approval-requests" className="ml-1 underline">
              二段階承認画面
            </Link>
            で別の管理者の承認をお待ちください。
          </p>
        )}
      </>  );
}
