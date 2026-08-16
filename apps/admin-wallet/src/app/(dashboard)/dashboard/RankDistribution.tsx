import type { RankDistributionItem } from "@/lib/api";

interface RankDistributionProps {
  data: RankDistributionItem[];
}

/** 会員ランク (docs/wallet-rank.md) の人数分布を横棒で表示する。 */
export function RankDistribution({ data }: RankDistributionProps) {
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return <p className="py-6 text-center text-xs text-sengoku-faint">表示できるデータがありません</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((rank) => (
        <li key={rank.name} className="flex items-center gap-3 text-xs">
          <span className="w-12 shrink-0 text-sengoku-muted">{rank.name}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-sengoku-border">
            <div
              className="h-full rounded-full bg-sengoku-gold"
              style={{ width: `${(rank.count / maxCount) * 100}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-semibold text-sengoku-text">
            {rank.count.toLocaleString("ja-JP")}人
          </span>
        </li>
      ))}
    </ul>
  );
}
