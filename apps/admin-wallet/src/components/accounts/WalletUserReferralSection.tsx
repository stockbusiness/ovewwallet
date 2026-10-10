"use client";

import { useEffect, useState } from "react";
import { apiFetch, type AdminWalletUserReferralView, type AdminWalletUserReferralRow } from "@/lib/api";

/** 状態の表示名。運用者が意味を読み取れる日本語にする。 */
const STATUS_LABEL: Record<string, string> = {
  REGISTERED: "成立",
  INHERITED: "代理店へ継承済み",
  EXCLUDED: "対象外",
  EXPIRED: "期限切れ",
  CAPTURED: "登録前",
};

/** 対象外になった理由。DBには英字で入れ、画面でだけ日本語にする。 */
const REASON_LABEL: Record<string, string> = {
  agency_referral_takes_precedence: "代理店紹介が優先されたため",
  self_referral: "自分自身の紹介リンクだったため",
};

function statusClass(status: string): string {
  if (status === "REGISTERED" || status === "INHERITED") return "text-sengoku-green";
  if (status === "EXCLUDED" || status === "EXPIRED") return "text-sengoku-muted";
  return "text-sengoku-faint";
}

/**
 * アカウント詳細の「ウォレット紹介」欄 (`docs/wallet-user-referral.md`)。
 *
 * 代理店紹介 (`/wallet-referrals`) とは別物。紹介した側がウォレット利用者である
 * 関係を出す。「紹介したはずなのに数に入らない」という問い合わせに答えるため、
 * **成立しなかった関係とその理由も表示する**。
 *
 * アカウント詳細とは別の取得にしている。取得に失敗してもアカウント詳細画面
 * 自体は表示を続けられるようにするため。
 */
export default function WalletUserReferralSection({ accountId }: { accountId: string }) {
  const [view, setView] = useState<AdminWalletUserReferralView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setView(
          await apiFetch<AdminWalletUserReferralView>(
            `/api/v1/admin/accounts/${accountId}/wallet-user-referrals`,
          ),
        );
      } catch {
        setFailed(true);
      }
    })();
  }, [accountId]);

  return (
    <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold">ウォレット紹介</h2>
        {view && <span className="text-xs text-sengoku-muted">成立: {view.established_count}件</span>}
      </div>
      <p className="mb-3 text-xs text-sengoku-muted">
        ウォレット利用者同士の紹介です。代理店紹介とは別に記録されます。
      </p>

      {failed && <p className="text-xs text-sengoku-faint">読み込めませんでした</p>}
      {!failed && !view && <p className="text-xs text-sengoku-faint">読み込み中...</p>}

      {view && (
        <>
          <h3 className="mb-1 text-xs font-semibold text-sengoku-muted">このアカウントを紹介した人</h3>
          {!view.referred_by && <p className="mb-3 text-xs text-sengoku-faint">ありません</p>}
          {view.referred_by && (
            <div className="mb-3">
              <ReferralRow row={view.referred_by} />
            </div>
          )}

          <h3 className="mb-1 text-xs font-semibold text-sengoku-muted">このアカウントが紹介した人</h3>
          {view.referrals_made.length === 0 && <p className="text-xs text-sengoku-faint">ありません</p>}
          <ul className="flex flex-col gap-1">
            {view.referrals_made.map((row) => (
              <li key={row.id}>
                <ReferralRow row={row} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ReferralRow({ row }: { row: AdminWalletUserReferralRow }) {
  const label = STATUS_LABEL[row.status] ?? row.status;
  const reason = row.reason ? REASON_LABEL[row.reason] ?? row.reason : null;
  const when = row.registered_at ?? row.captured_at;

  return (
    <div className="border-t border-sengoku-border py-1 text-xs first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{row.display_name || row.account_code || "(アカウント未確定)"}</span>
        <span className={statusClass(row.status)}>{label}</span>
        <span className="text-sengoku-faint">{new Date(when).toLocaleDateString("ja-JP")}</span>
      </div>
      {reason && <p className="mt-0.5 text-sengoku-faint">{reason}</p>}
    </div>
  );
}
