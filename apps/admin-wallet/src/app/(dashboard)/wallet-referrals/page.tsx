"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, ApiError, type FeatureFlags, type WalletReferralItem } from "@/lib/api";
import { toDisplayCode } from "@ove/shared-ui";

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
  CAPTURED: "text-sengoku-muted",
  PENDING: "text-sengoku-gold-soft",
  CONFIRMED: "text-sengoku-green",
  REJECTED: "text-sengoku-red",
  MANUALLY_CONFIRMED: "text-sengoku-green",
  CANCELLED: "text-sengoku-faint",
  ERROR: "text-sengoku-red",
  EXPIRED: "text-sengoku-faint",
};

export default function WalletReferralsPage() {
  const router = useRouter();
  const [items, setItems] = useState<WalletReferralItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legacyBonusFlag, setLegacyBonusFlag] = useState<boolean | null>(null);

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

  useEffect(() => {
    apiFetch<FeatureFlags>("/api/v1/admin/feature-flags")
      .then((flags) => setLegacyBonusFlag(flags.ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS ?? false))
      .catch(() => setLegacyBonusFlag(null));
  }, []);

  return (
    <>
        <h1 className="mb-1 text-xl font-bold">代理店紹介トークン受け入れ</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          代理店紹介URL (<code>/invite/&#123;token&#125;</code>) 経由の受付・新規登録時の紐付け・
          初回登録特典3,000 ORIの状態を確認する画面。紐付かなかった紹介は、この画面から
          後付けでORIアカウントへ紐付けできます。
        </p>

        <div className="mb-4 rounded-lg border border-sengoku-gold-soft bg-sengoku-navy-deep p-3 text-xs text-sengoku-muted">
          <p className="font-semibold text-sengoku-gold-soft">
            旧制度について: 初回登録特典(3,000 ORI)は旧制度です。千ノ国5システム改修 PR-W1
            (新規発生停止日: 2026-08-20)により、新規のPENDING作成を停止しています。
          </p>
          <p className="mt-1">
            現在の状態:{" "}
            {legacyBonusFlag === null ? (
              "取得中/取得失敗"
            ) : legacyBonusFlag ? (
              <span className="text-sengoku-red">
                旧挙動を維持中(ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS=true、新規PENDINGが作成されます)
              </span>
            ) : (
              <span className="text-sengoku-green">停止中(新規PENDINGは作成されません)</span>
            )}
          </p>
          <p className="mt-1">
            この画面に表示されている既存のPENDING/CONFIRMED/REJECTEDの特典履歴・ORI残高は、
            この停止によって削除・変更されることはありません。
          </p>
        </div>

        <HelpPanel storageKey="wallet-referrals" title="このページについて・使い方">
          <p>
            代理店の紹介URL(<code>/invite/&#123;token&#125;</code>)経由でORIウォレットに登録した人が、
            紹介関係として正しく成立し、初回登録特典(3,000 ORI)が付与されたかを確認する画面です。
          </p>
          <div>
            <p className="font-semibold text-sengoku-text">状態の意味</p>
            <ul className="ml-4 list-disc">
              <li>受付済み(登録前): 紹介URLはクリックされたが、まだORIウォレットへの登録が完了していない</li>
              <li>登録済み・確認待ち: 登録は完了したが、紹介関係の最終確認が済んでいない</li>
              <li>紹介関係確定: 正常に成立し、特典も処理された状態</li>
              <li>否認/エラー/期限切れ/取消: 何らかの理由で成立しなかった状態</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-sengoku-text">後付けで紐付ける</p>
            <p>
              紹介の紐付けは<strong className="text-sengoku-text">新規登録のときにしか起きません</strong>。
              先にウォレットへ登録した人が後から紹介URLを踏んでも、代理店の成果にはなりません
              (退会させても救済になりません。退会済みのLINEアカウントでは再登録できないためです)。
              その個別対応がこの操作です。
            </p>
            <ul className="ml-4 list-disc">
              <li>「受付済み(登録前)」の行の「詳細」を開き、ORIアカウントのコード(ORI-ACC-…)と理由を入れて「このアカウントへ紐付ける」を押します</li>
              <li>状態は「登録済み・確認待ち」になります。<strong className="text-sengoku-text">確定にはしません</strong> — 成果を認めるかどうかの正本は代理店システム側にあるためです</li>
              <li>そのあと代理店システムへ自動で確定を送り、先方が認めれば「紹介関係確定」に変わります</li>
              <li>誰がいつ何を理由に紐付けたかは監査ログに残ります</li>
            </ul>
            <p className="text-sengoku-gold-soft">
              代理店の成果の宛先を決める操作です。本人のアカウントであることを必ず確認してください。
              1つのアカウントに紐付けられる紹介は1件までです。
            </p>
          </div>
        </HelpPanel>

        {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor="statusFilter">状態:</label>
          <select
            id="statusFilter"
            className="rounded border border-sengoku-border px-2 py-1"
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

        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">状態</th>
              <th className="p-3">登録ORIアカウント</th>
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
                  <tr className="border-t border-sengoku-border align-top">
                    <td className="p-3">
                      <span className={STATUS_CLASS[item.status]}>{STATUS_LABEL[item.status]}</span>
                    </td>
                    <td className="p-3">
                      {item.account ? `${toDisplayCode(item.account.accountCode)} (${item.account.displayName ?? "-"})` : "-"}
                    </td>
                    <td className="p-3">{item.agencyId ?? "-"}</td>
                    <td className="p-3">
                      {benefit ? `${Number(benefit.amount).toLocaleString("ja-JP")} ORI (${benefit.status})` : "-"}
                    </td>
                    <td className="p-3">{new Date(item.capturedAt).toLocaleString("ja-JP")}</td>
                    <td className="p-3">
                      <button
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        className="text-xs text-sengoku-gold underline"
                      >
                        {expandedId === item.id ? "閉じる" : "詳細"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr className="border-t border-sengoku-border bg-sengoku-navy-deep">
                      <td colSpan={6} className="p-3">
                        <dl className="grid grid-cols-2 gap-2 text-xs text-sengoku-muted sm:grid-cols-3">
                          <div>
                            <dt className="text-sengoku-faint">受付元 (source)</dt>
                            <dd>{item.source}</dd>
                          </div>
                          <div>
                            <dt className="text-sengoku-faint">有効期限 (expires_at)</dt>
                            <dd>{new Date(item.expiresAt).toLocaleString("ja-JP")}</dd>
                          </div>
                          <div>
                            <dt className="text-sengoku-faint">登録日時</dt>
                            <dd>{item.registeredAt ? new Date(item.registeredAt).toLocaleString("ja-JP") : "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-sengoku-faint">最終エラー</dt>
                            <dd>{item.lastErrorMessage ?? "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-sengoku-faint">備考</dt>
                            <dd>{item.reason ?? "-"}</dd>
                          </div>
                        </dl>
                        {item.status === "CAPTURED" && !item.account && (
                          <ManualAttachForm referral={item} onDone={load} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-sengoku-faint">
                  該当する紹介はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </>  );
}

/**
 * 紹介URLは踏まれたのに登録へ紐付かなかった紹介を、後からORIアカウントへ紐付ける。
 * 代理店の成果の宛先を決める操作なので、確認の一手間 (confirm) を必ず挟む。
 */
function ManualAttachForm({
  referral,
  onDone,
}: {
  referral: WalletReferralItem;
  onDone: () => void;
}) {
  const [account, setAccount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!account.trim() || !reason.trim()) {
      setError("ORIアカウントと理由の両方が必要です");
      return;
    }
    if (
      !window.confirm(
        `紹介をORIアカウント ${account} へ紐付けます。\n\n` +
          "代理店の成果の宛先を決める操作です。本人のアカウントであることを確認しましたか？",
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/wallet-referrals/${referral.id}/attach`, {
        method: "POST",
        body: JSON.stringify({ account: account.trim(), reason: reason.trim() }),
      });
      setAccount("");
      setReason("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "紐付けに失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 border-t border-sengoku-border pt-3">
      <p className="mb-2 text-xs font-semibold text-sengoku-text">後付けで紐付ける</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-sengoku-muted">
          ORIアカウント
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="ORI-ACC-00000001"
            className="ml-2 rounded border border-sengoku-border bg-sengoku-navy px-2 py-1 text-sengoku-text"
          />
        </label>
        <label className="text-xs text-sengoku-muted">
          理由 (監査ログに残ります)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="先にLINEで登録済みだったため"
            className="ml-2 w-64 rounded border border-sengoku-border bg-sengoku-navy px-2 py-1 text-sengoku-text"
          />
        </label>
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded bg-sengoku-red px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          {submitting ? "処理中..." : "このアカウントへ紐付ける"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-sengoku-red">{error}</p>}
    </div>
  );
}
