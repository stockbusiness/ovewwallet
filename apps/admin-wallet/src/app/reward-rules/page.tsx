"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type RewardRuleItem } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [ruleCode, setRuleCode] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [sourceService, setSourceService] = useState(SERVICE_CODES[0]);
  const [rewardAmount, setRewardAmount] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [perUserLimit, setPerUserLimit] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<RewardRuleItem[]>("/api/v1/admin/reward-rules");
      setRules(list);
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
        }),
      });
      setMessage("ルールを作成しました");
      setRuleCode("");
      setRuleName("");
      setRewardAmount("");
      setDisplayName("");
      setPerUserLimit("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "作成に失敗しました");
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
    <div>
      <AdminNav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-1 text-xl font-bold">付与ルール管理</h1>
        <p className="mb-4 text-xs text-neutral-500">
          既存の登録特典 (SENGOKU_REGISTRATION_BONUS) ・AIアート教室参加特典
          (AIART_ATTENDANCE_REWARD) の上限・状態はここから調整できます。新規ルールは
          rewards.service.ts の対応表に無いtransaction_typeでは外部APIから自動適用されません。
        </p>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">新規ルール作成</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              ルールコード
              <input value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} className="mt-1 block w-48 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              ルール名
              <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              対象サービス
              <select value={sourceService} onChange={(e) => setSourceService(e.target.value)} className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm">
                {SERVICE_CODES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              付与額 (OVE)
              <input value={rewardAmount} onChange={(e) => setRewardAmount(e.target.value)} className="mt-1 block w-28 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              表示名
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 block w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              ユーザー上限回数
              <input value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} className="mt-1 block w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
            </label>
            <button
              onClick={createRule}
              disabled={!ruleCode || !ruleName || !rewardAmount || !displayName}
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
              <th className="p-3">ルールコード</th>
              <th className="p-3">サービス</th>
              <th className="p-3">付与額</th>
              <th className="p-3">上限 (ユーザー/イベント)</th>
              <th className="p-3">状態</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="p-3">
                  {r.ruleCode}
                  <p className="text-xs text-neutral-400">{r.displayName}</p>
                </td>
                <td className="p-3">{r.sourceService}</td>
                <td className="p-3">{Number(r.rewardAmount).toLocaleString("ja-JP")} OVE</td>
                <td className="p-3">
                  {r.perUserLimit ?? "-"} / {r.perEventLimit ?? "-"}
                </td>
                <td className="p-3">
                  <span className={r.status === "ACTIVE" ? "text-emerald-600" : "text-neutral-400"}>{r.status}</span>
                </td>
                <td className="p-3">
                  <button onClick={() => toggleStatus(r)} className="text-xs text-brand-600 underline">
                    {r.status === "ACTIVE" ? "無効化" : "有効化"}
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
