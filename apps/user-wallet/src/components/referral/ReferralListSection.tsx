import type { WalletUserReferralItem } from "@/lib/api";

/**
 * 紹介した相手の一覧。
 *
 * 相手の個人情報は出さず、表示名とアカウントコードまでに留める
 * (紹介した側が相手のメールアドレス等を見られる必要は無い)。
 */
export default function ReferralListSection({
  referrals,
  count,
}: {
  referrals: WalletUserReferralItem[];
  count: number;
}) {
  return (
    <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-sengoku-text">紹介した方</p>
        <p className="text-sm font-bold text-sengoku-gold">{count}人</p>
      </div>

      {referrals.length === 0 && (
        <p className="mt-2 text-xs text-sengoku-faint">まだいらっしゃいません。</p>
      )}

      <ul className="mt-2 flex flex-col gap-2">
        {referrals.map((r) => (
          <li key={r.account_code} className="border-t border-sengoku-border pt-2 first:border-t-0 first:pt-0">
            <p className="text-sm text-sengoku-text">{r.display_name || r.account_code}</p>
            <p className="mt-0.5 text-xs text-sengoku-faint">
              {r.registered_at ? `${new Date(r.registered_at).toLocaleDateString("ja-JP")}登録` : "登録日不明"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
