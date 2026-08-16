"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, type RewardRuleItem, type RewardRuleIssuanceSummaryItem } from "@/lib/api";

const SERVICE_CODES = [
  "SENGOKU_PASSPORT",
  "AIART",
  "SENGOKU_GACHA",
  "SENGOKU_EC",
  "NFT_MARKET",
  "SENGOKU_METAVERSE",
  "EVENT_SYSTEM",
];

export default function RewardRulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState<RewardRuleItem[]>([]);
  const [issuanceSummary, setIssuanceSummary] = useState<Map<string, RewardRuleIssuanceSummaryItem>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [ruleCode, setRuleCode] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [sourceService, setSourceService] = useState(SERVICE_CODES[0]);
  const [rewardAmount, setRewardAmount] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [perUserLimit, setPerUserLimit] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [expiryResult, setExpiryResult] = useState<string | null>(null);
  const [expiryRunning, setExpiryRunning] = useState(false);
  const [expiryPreview, setExpiryPreview] = useState<string | null>(null);
  const [expiryPreviewLoading, setExpiryPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<RewardRuleItem[]>("/api/v1/admin/reward-rules");
      setRules(list);
      const summary = await apiFetch<RewardRuleIssuanceSummaryItem[]>("/api/v1/admin/reward-rules/issuance-summary");
      setIssuanceSummary(new Map(summary.map((s) => [s.ruleCode, s])));
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

  async function createRule() {
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/v1/admin/reward-rules", {
        method: "POST",
        body: JSON.stringify({
          ruleCode,
          ruleName,
          sourceService,
          rewardAmount: Number(rewardAmount),
          displayName,
          perUserLimit: perUserLimit ? Number(perUserLimit) : undefined,
          expiryDays: expiryDays ? Number(expiryDays) : undefined,
        }),
      });
      setMessage("ルールを作成しました");
      setRuleCode("");
      setRuleName("");
      setRewardAmount("");
      setDisplayName("");
      setPerUserLimit("");
      setExpiryDays("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "作成に失敗しました");
    }
  }

  async function previewExpiryBatch() {
    setExpiryPreviewLoading(true);
    setExpiryPreview(null);
    setError(null);
    try {
      const result = await apiFetch<{ wallets_affected: number; total_amount: string }>(
        "/api/v1/admin/expire-credits/preview",
      );
      setExpiryPreview(
        `今すぐ実行すると、${result.wallets_affected}件のウォレットで合計${Number(result.total_amount).toLocaleString("ja-JP")} OVEが失効します`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "予告レポートの取得に失敗しました");
    } finally {
      setExpiryPreviewLoading(false);
    }
  }

  async function runExpiryBatch() {
    setExpiryRunning(true);
    setExpiryResult(null);
    setError(null);
    try {
      const result = await apiFetch<{ wallets_processed: number; total_expired_amount: string }>(
        "/api/v1/admin/expire-credits",
        { method: "POST" },
      );
      setExpiryResult(
        `${result.wallets_processed}件のウォレットで、合計${Number(result.total_expired_amount).toLocaleString("ja-JP")} OVEを失効させました`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失効バッチの実行に失敗しました");
    } finally {
      setExpiryRunning(false);
    }
  }

  async function toggleStatus(rule: RewardRuleItem) {
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/reward-rules/${rule.ruleCode}`, {
        method: "PATCH",
        body: JSON.stringify({ status: rule.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新に失敗しました");
    }
  }

  return (
    <>
        <h1 className="mb-1 text-xl font-bold">付与ルール管理</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          既存の登録特典 (SENGOKU_REGISTRATION_BONUS) ・AIアート教室参加特典
          (AIART_ATTENDANCE_REWARD) の上限・状態はここから調整できます。新規ルールは
          rewards.service.ts の対応表に無いtransaction_typeでは外部APIから自動適用されません。
        </p>

        <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-3 text-sm font-semibold">新規ルール作成</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              ルールコード
              <input value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} className="mt-1 block w-48 rounded-md border border-sengoku-border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              ルール名
              <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} className="mt-1 block w-40 rounded-md border border-sengoku-border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              対象サービス
              <select value={sourceService} onChange={(e) => setSourceService(e.target.value)} className="mt-1 block w-40 rounded-md border border-sengoku-border px-2 py-1 text-sm">
                {SERVICE_CODES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              付与額 (OVE)
              <input value={rewardAmount} onChange={(e) => setRewardAmount(e.target.value)} className="mt-1 block w-28 rounded-md border border-sengoku-border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              表示名
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 block w-40 rounded-md border border-sengoku-border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              ユーザー上限回数
              <input value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} className="mt-1 block w-24 rounded-md border border-sengoku-border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              有効期限 (日、空欄なら失効しない)
              <input value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} className="mt-1 block w-24 rounded-md border border-sengoku-border px-2 py-1 text-sm" />
            </label>
            <button
              onClick={createRule}
              disabled={!ruleCode || !ruleName || !rewardAmount || !displayName}
              className="rounded-md bg-sengoku-gold px-4 py-1.5 text-sm text-sengoku-navy-deep disabled:opacity-50"
            >
              作成
            </button>
          </div>
          {message && <p className="mt-2 text-sm text-sengoku-green">{message}</p>}
          {error && <p className="mt-2 text-sm text-sengoku-red">{error}</p>}
        </section>

        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">ルールコード</th>
              <th className="p-3">サービス</th>
              <th className="p-3">付与額</th>
              <th className="p-3">上限 (ユーザー/イベント)</th>
              <th className="p-3">有効期限</th>
              <th className="p-3">累計発行 (額/件数)</th>
              <th className="p-3">状態</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const summary = issuanceSummary.get(r.ruleCode);
              return (
                <tr key={r.id} className="border-t border-sengoku-border">
                  <td className="p-3">
                    {r.ruleCode}
                    <p className="text-xs text-sengoku-faint">{r.displayName}</p>
                  </td>
                  <td className="p-3">{r.sourceService}</td>
                  <td className="p-3">{Number(r.rewardAmount).toLocaleString("ja-JP")} OVE</td>
                  <td className="p-3">
                    {r.perUserLimit ?? "-"} / {r.perEventLimit ?? "-"}
                  </td>
                  <td className="p-3">{r.expiryDays ? `${r.expiryDays}日` : "失効しない"}</td>
                  <td className="p-3">
                    {summary && summary.totalAmount !== null ? (
                      <>
                        {Number(summary.totalAmount).toLocaleString("ja-JP")} OVE
                        <p className="text-xs text-sengoku-faint">{summary.count}件</p>
                      </>
                    ) : (
                      <span className="text-xs text-sengoku-faint">集計不可</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={r.status === "ACTIVE" ? "text-sengoku-green" : "text-sengoku-faint"}>{r.status}</span>
                  </td>
                  <td className="p-3">
                    <button onClick={() => toggleStatus(r)} className="text-xs text-sengoku-gold underline">
                      {r.status === "ACTIVE" ? "無効化" : "有効化"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <section className="mt-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-1 text-sm font-semibold">OVE失効バッチ</h2>
          <p className="mb-3 text-xs text-sengoku-muted">
            有効期限が到来した獲得OVEを失効させます。cron等の外部スケジューラは未接続のため、
            当面はここから手動実行してください (docs/credit-expiry.md参照)。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={previewExpiryBatch}
              disabled={expiryPreviewLoading}
              className="rounded-md border border-sengoku-border px-4 py-1.5 text-sm text-sengoku-text disabled:opacity-50"
            >
              {expiryPreviewLoading ? "確認中..." : "失効予告レポートを確認"}
            </button>
            <button
              onClick={runExpiryBatch}
              disabled={expiryRunning}
              className="rounded-md bg-sengoku-gold px-4 py-1.5 text-sm text-sengoku-navy-deep disabled:opacity-50"
            >
              {expiryRunning ? "実行中..." : "失効バッチを今すぐ実行"}
            </button>
          </div>
          {expiryPreview && <p className="mt-2 text-sm text-sengoku-text">{expiryPreview}</p>}
          {expiryResult && <p className="mt-2 text-sm text-sengoku-green">{expiryResult}</p>}
        </section>
      </>  );
}
