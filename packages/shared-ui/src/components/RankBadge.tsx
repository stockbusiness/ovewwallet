import { getWalletRank, getNextWalletRank } from "../rank";

export interface RankBadgeProps {
  lifetimeCredited: number;
}

/** 累計獲得OVEに応じた戦国ブランドの称号バッジ (足軽→侍→武将→大名→天下人)。 */
export function RankBadge({ lifetimeCredited }: RankBadgeProps) {
  const rank = getWalletRank(lifetimeCredited);
  const next = getNextWalletRank(lifetimeCredited);

  return (
    <section className="rounded-xl border border-sengoku-gold/40 bg-sengoku-navy p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-sengoku-muted">現在の階級</p>
          <p className="mt-0.5 font-heading text-lg font-bold text-sengoku-gold">{rank.name}</p>
        </div>
        <p className="text-xs text-sengoku-faint">
          累計獲得
          <br />
          {lifetimeCredited.toLocaleString("ja-JP")} OVE
        </p>
      </div>
      {next && (
        <p className="mt-2 text-xs text-sengoku-muted">
          あと{next.remaining.toLocaleString("ja-JP")} OVEで「{next.rank.name}」に昇格
        </p>
      )}
    </section>
  );
}
