export interface BalanceStat {
  label: string;
  value: string;
}

export interface BalanceCardProps {
  label?: string;
  amount: string;
  unit?: string;
  stats?: BalanceStat[];
  footnote?: string;
}

/** 利用可能残高を強調表示するカード。ウォレットホーム・管理ダッシュボード双方で使う。 */
export function BalanceCard({ label = "利用可能残高", amount, unit = "OVE", stats = [], footnote }: BalanceCardProps) {
  return (
    <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-5 shadow-lg shadow-black/30">
      <p className="text-sm text-sengoku-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-4xl font-bold tracking-tight text-sengoku-gold">{amount}</span>
        <span className="text-base font-semibold text-sengoku-gold-soft">{unit}</span>
      </p>
      {stats.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-sengoku-border pt-3">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-sengoku-muted">{s.label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-white">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {footnote && <p className="mt-3 text-xs leading-relaxed text-sengoku-faint">{footnote}</p>}
    </section>
  );
}
