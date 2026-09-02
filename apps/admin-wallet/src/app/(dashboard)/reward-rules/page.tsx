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

/**
 * 編集フォームの値。数値・日時も含めてすべて文字列で保持し、送信直前に変換する。
 * 「空欄 = 上限なし (null)」を表現する必要があり、数値stateだと空欄とゼロを
 * 区別できないため。
 */
interface EditForm {
  ruleName: string;
  displayName: string;
  description: string;
  rewardAmount: string;
  perUserLimit: string;
  perEventLimit: string;
  monthlyCountLimit: string;
  monthlyAmountLimit: string;
  globalAmountLimit: string;
  expiryDays: string;
  startsAt: string;
  endsAt: string;
}

const EMPTY_EDIT_FORM: EditForm = {
  ruleName: "",
  displayName: "",
  description: "",
  rewardAmount: "",
  perUserLimit: "",
  perEventLimit: "",
  monthlyCountLimit: "",
  monthlyAmountLimit: "",
  globalAmountLimit: "",
  expiryDays: "",
  startsAt: "",
  endsAt: "",
};

/** ISO文字列を `<input type="datetime-local">` が受け付ける形式に変換する。 */
function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toEditForm(rule: RewardRuleItem): EditForm {
  return {
    ruleName: rule.ruleName,
    displayName: rule.displayName,
    description: rule.description ?? "",
    rewardAmount: rule.rewardAmount,
    perUserLimit: rule.perUserLimit === null ? "" : String(rule.perUserLimit),
    perEventLimit: rule.perEventLimit === null ? "" : String(rule.perEventLimit),
    monthlyCountLimit: rule.monthlyCountLimit === null ? "" : String(rule.monthlyCountLimit),
    monthlyAmountLimit: rule.monthlyAmountLimit ?? "",
    globalAmountLimit: rule.globalAmountLimit ?? "",
    expiryDays: rule.expiryDays === null ? "" : String(rule.expiryDays),
    startsAt: toDateTimeLocal(rule.startsAt),
    endsAt: toDateTimeLocal(rule.endsAt),
  };
}

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

  // 編集中のルール。null なら編集フォームを出さない。
  const [editing, setEditing] = useState<RewardRuleItem | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [saving, setSaving] = useState(false);

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
        `今すぐ実行すると、${result.wallets_affected}件のウォレットで合計${Number(result.total_amount).toLocaleString("ja-JP")} ORIが失効します`,
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
        `${result.wallets_processed}件のウォレットで、合計${Number(result.total_expired_amount).toLocaleString("ja-JP")} ORIを失効させました`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失効バッチの実行に失敗しました");
    } finally {
      setExpiryRunning(false);
    }
  }

  /**
   * 参加方法の案内先URL (LINE友だち追加など) を設定する。
   *
   * URLはサービス側の都合で変わるため、コードに埋めず運用側で変更できるようにしている
   * (docs/reward-landing-url.md)。空のまま確定すると未設定に戻せる。
   */
  async function editLandingUrl(rule: RewardRuleItem) {
    const input = window.prompt(
      `${rule.displayName} の案内先URL\n\nhttps:// で始まるURLを入力してください。空にすると導線を出しません。`,
      rule.landingUrl ?? "",
    );
    if (input === null) return; // キャンセル

    setError(null);
    try {
      await apiFetch(`/api/v1/admin/reward-rules/${rule.ruleCode}`, {
        method: "PATCH",
        body: JSON.stringify({ landingUrl: input.trim() }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "案内先URLの更新に失敗しました");
    }
  }

  function startEdit(rule: RewardRuleItem) {
    setError(null);
    setMessage(null);
    setEditing(rule);
    setEditForm(toEditForm(rule));
  }

  /**
   * 変更した項目だけをPATCHで送る。上限や有効期間は「空欄 = 上限なし」を意味するため、
   * 空欄は `null` として送り、明示的に解除できるようにする
   * (`UpdateRewardRuleSchema` が nullable を受け付ける)。
   */
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    setMessage(null);

    const amount = Number(editForm.rewardAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("付与額は1以上の整数で入力してください");
      return;
    }

    const optionalNumber = (value: string): number | null => {
      const trimmed = value.trim();
      if (trimmed === "") return null;
      const n = Number(trimmed);
      return Number.isInteger(n) && n > 0 ? n : Number.NaN;
    };
    const limits = {
      perUserLimit: optionalNumber(editForm.perUserLimit),
      perEventLimit: optionalNumber(editForm.perEventLimit),
      monthlyCountLimit: optionalNumber(editForm.monthlyCountLimit),
      monthlyAmountLimit: optionalNumber(editForm.monthlyAmountLimit),
      globalAmountLimit: optionalNumber(editForm.globalAmountLimit),
      expiryDays: optionalNumber(editForm.expiryDays),
    };
    if (Object.values(limits).some((v) => v !== null && Number.isNaN(v))) {
      setError("上限と有効期限日数は、空欄か1以上の整数で入力してください");
      return;
    }

    const toIso = (value: string): string | null => (value === "" ? null : new Date(value).toISOString());
    const startsAt = toIso(editForm.startsAt);
    const endsAt = toIso(editForm.endsAt);
    if (startsAt !== null && endsAt !== null && new Date(startsAt) >= new Date(endsAt)) {
      setError("終了日時は開始日時より後にしてください");
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/api/v1/admin/reward-rules/${editing.ruleCode}`, {
        method: "PATCH",
        body: JSON.stringify({
          ruleName: editForm.ruleName,
          displayName: editForm.displayName,
          description: editForm.description,
          rewardAmount: amount,
          ...limits,
          startsAt,
          endsAt,
        }),
      });
      setMessage(`${editing.ruleCode} を更新しました。`);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新に失敗しました");
    } finally {
      setSaving(false);
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
              付与額 (ORI)
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

        {editing && (
          <section className="mb-4 rounded-lg border border-sengoku-gold bg-sengoku-navy p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">
                付与ルールを編集: <span className="font-mono">{editing.ruleCode}</span>
              </h2>
              <button onClick={() => setEditing(null)} className="text-xs text-sengoku-muted underline">
                閉じる
              </button>
            </div>
            <p className="mb-3 text-xs text-sengoku-muted">
              ルールコードとサービスは変更できません (過去の付与履歴との対応が追えなくなるため)。
              上限と有効期間は<strong className="text-sengoku-text">空欄にすると「制限なし」</strong>になります。
              変更は<strong className="text-sengoku-text">これ以降の付与にのみ</strong>適用され、
              すでに付与済みのORIは変わりません。
            </p>
            <form onSubmit={saveEdit} className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs">
                  表示名 (利用者に見える名前)
                  <input
                    required
                    value={editForm.displayName}
                    onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs">
                  ルール名 (管理用)
                  <input
                    required
                    value={editForm.ruleName}
                    onChange={(e) => setEditForm({ ...editForm, ruleName: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs">
                  付与額 (ORI)
                  <input
                    required
                    inputMode="numeric"
                    value={editForm.rewardAmount}
                    onChange={(e) => setEditForm({ ...editForm, rewardAmount: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs sm:col-span-2 lg:col-span-3">
                  説明
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                  />
                </label>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold text-sengoku-muted">上限 (空欄は制限なし)</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs">
                    1人あたり件数
                    <input
                      inputMode="numeric"
                      value={editForm.perUserLimit}
                      onChange={(e) => setEditForm({ ...editForm, perUserLimit: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs">
                    1イベントあたり件数
                    <input
                      inputMode="numeric"
                      value={editForm.perEventLimit}
                      onChange={(e) => setEditForm({ ...editForm, perEventLimit: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs">
                    月あたり件数
                    <input
                      inputMode="numeric"
                      value={editForm.monthlyCountLimit}
                      onChange={(e) => setEditForm({ ...editForm, monthlyCountLimit: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs">
                    月あたり金額 (ORI)
                    <input
                      inputMode="numeric"
                      value={editForm.monthlyAmountLimit}
                      onChange={(e) => setEditForm({ ...editForm, monthlyAmountLimit: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs">
                    全体の累計金額 (ORI)
                    <input
                      inputMode="numeric"
                      value={editForm.globalAmountLimit}
                      onChange={(e) => setEditForm({ ...editForm, globalAmountLimit: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs">
                    付与ORIの有効期限 (日)
                    <input
                      inputMode="numeric"
                      value={editForm.expiryDays}
                      onChange={(e) => setEditForm({ ...editForm, expiryDays: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                    />
                  </label>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold text-sengoku-muted">有効期間 (空欄は無期限)</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs">
                    開始日時
                    <input
                      type="datetime-local"
                      value={editForm.startsAt}
                      onChange={(e) => setEditForm({ ...editForm, startsAt: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs">
                    終了日時
                    <input
                      type="datetime-local"
                      value={editForm.endsAt}
                      onChange={(e) => setEditForm({ ...editForm, endsAt: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                    />
                  </label>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存する"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-md border border-sengoku-border px-4 py-2 text-sm font-semibold"
                >
                  キャンセル
                </button>
              </div>
            </form>
          </section>
        )}

        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">ルールコード</th>
              <th className="p-3">サービス</th>
              <th className="p-3">付与額</th>
              <th className="p-3">上限 (ユーザー/イベント)</th>
              <th className="p-3">有効期限</th>
              <th className="p-3">案内先URL</th>
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
                  <td className="p-3">{Number(r.rewardAmount).toLocaleString("ja-JP")} ORI</td>
                  <td className="p-3">
                    {r.perUserLimit ?? "-"} / {r.perEventLimit ?? "-"}
                  </td>
                  <td className="p-3">{r.expiryDays ? `${r.expiryDays}日` : "失効しない"}</td>
                  <td className="max-w-[14rem] p-3">
                    {r.landingUrl ? (
                      <span className="block truncate text-xs text-sengoku-text" title={r.landingUrl}>
                        {r.landingUrl}
                      </span>
                    ) : (
                      <span className="text-xs text-sengoku-faint">未設定 (導線を出さない)</span>
                    )}
                    <button onClick={() => editLandingUrl(r)} className="mt-1 text-xs text-sengoku-gold underline">
                      {r.landingUrl ? "変更" : "設定"}
                    </button>
                  </td>
                  <td className="p-3">
                    {summary && summary.totalAmount !== null ? (
                      <>
                        {Number(summary.totalAmount).toLocaleString("ja-JP")} ORI
                        <p className="text-xs text-sengoku-faint">{summary.count}件</p>
                      </>
                    ) : (
                      <span className="text-xs text-sengoku-faint">集計不可</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={r.status === "ACTIVE" ? "text-sengoku-green" : "text-sengoku-faint"}>{r.status}</span>
                  </td>
                  <td className="whitespace-nowrap p-3">
                    <button onClick={() => startEdit(r)} className="text-xs text-sengoku-gold underline">
                      編集
                    </button>
                    <button onClick={() => toggleStatus(r)} className="ml-3 text-xs text-sengoku-gold underline">
                      {r.status === "ACTIVE" ? "無効化" : "有効化"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <section className="mt-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-1 text-sm font-semibold">ORI失効バッチ</h2>
          <p className="mb-3 text-xs text-sengoku-muted">
            有効期限が到来した獲得ORIを失効させます。cron等の外部スケジューラは未接続のため、
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
