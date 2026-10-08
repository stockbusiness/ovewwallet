"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

/** APIの返り値 (`AdminCommonUserResolveService.run`)。 */
interface ResolveCommonUserResponse {
  outcome:
    | "linked"
    | "already_linked"
    | "conflict"
    | "not_configured"
    | "hub_unavailable"
    | "failed";
  message: string;
  commonUserId: string | null;
}

/** 成功扱い (緑) にする結果。それ以外は要対応として赤で出す。 */
const SUCCESS_OUTCOMES = new Set(["linked", "already_linked"]);

/**
 * アカウント詳細の「共通ID」欄。
 *
 * common_user_idは**新規登録時の自動解決**か共通イベント受信でしか入らず、
 * 登録時の解決は共通顧客HUBが未設定・誤設定でも登録を成功させるベストエフォート。
 * そのため設定が揃っていない期間に作られたアカウントは空のまま固定され、
 * デジタル会員証の付与 (`entitlement.granted`) もカード受取も通らなくなる。
 * あとから解決し直せるようにするのがこの欄の役目。
 */
export default function CommonUserSection({
  accountId,
  commonUserId,
  onResolved,
}: {
  accountId: string;
  commonUserId: string | null;
  onResolved: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ResolveCommonUserResponse | null>(null);

  async function resolve() {
    setRunning(true);
    setResult(null);
    try {
      const res = await apiFetch<ResolveCommonUserResponse>(
        `/api/v1/admin/accounts/${accountId}/resolve-common-user`,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      setResult(res);
      setReason("");
      await onResolved();
    } catch (err) {
      setResult({
        outcome: "failed",
        message: err instanceof ApiError ? err.message : "再解決に失敗しました。",
        commonUserId: null,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
      <h2 className="mb-3 text-sm font-semibold">共通ID (共通顧客HUB)</h2>
      <dl className="mb-3 grid grid-cols-[7rem_1fr] gap-y-1 text-xs">
        <dt className="text-sengoku-muted">common_user_id</dt>
        <dd className="break-all">{commonUserId ?? <span className="text-sengoku-red">未解決</span>}</dd>
      </dl>
      {!commonUserId && (
        <p className="mb-3 text-xs text-sengoku-gold-soft">
          共通IDが未解決のため、このアカウントではデジタル会員証の付与とカード受取が通りません。
          共通顧客HUBへ問い合わせて解決し直してください。
        </p>
      )}
      <p className="mb-3 text-xs text-sengoku-muted">
        共通顧客HUBに問い合わせ、このアカウントの共通IDを取り直して紐付けます。
        既に紐付いている場合は何も変わりません (何度実行しても安全です)。
      </p>
      <div className="flex flex-col gap-3">
        <label className="text-xs">
          実行理由 (操作ログに残ります)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: カード受取が共通ID未解決で止まるため再解決"
            className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={resolve}
          disabled={running || !reason}
          className="self-start rounded-md bg-sengoku-gold px-3 py-1.5 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
        >
          {running ? "問い合わせ中..." : "共通IDを再解決する"}
        </button>
      </div>
      {result && (
        <div
          className={`mt-3 rounded-md p-3 text-xs ${
            SUCCESS_OUTCOMES.has(result.outcome)
              ? "bg-sengoku-green/10 text-sengoku-green"
              : "bg-sengoku-red/10 text-sengoku-red"
          }`}
        >
          <p>{result.message}</p>
          {result.commonUserId && <p className="mt-1 break-all">共通ID: {result.commonUserId}</p>}
        </div>
      )}
    </section>
  );
}
