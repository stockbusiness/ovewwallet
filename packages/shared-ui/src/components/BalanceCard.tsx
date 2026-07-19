import { ChevronRightIcon } from "../icons";

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

/**
 * 利用可能残高を強調表示するカード。ウォレットホームの主役要素となるよう、
 * 金のグラデーション枠とグロー、天守閣シルエットの薄い装飾を持つ。
 */
export function BalanceCard({ label = "利用可能残高", amount, unit = "OVE", stats = [], footnote }: BalanceCardProps) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-sengoku-gold/50 bg-gradient-to-br from-sengoku-navy via-sengoku-navy to-sengoku-navy-deep p-5"
      style={{ boxShadow: "0 0 0 1px rgba(212,175,55,0.08), 0 12px 32px rgba(0,0,0,0.45), 0 0 24px rgba(212,175,55,0.1)" }}
    >
      <CastleSilhouette className="pointer-events-none absolute -bottom-2 -right-4 h-32 w-32 text-sengoku-gold opacity-[0.14]" />
      <div className="relative z-10">
        <div className="flex items-center justify-between">
          <p className="text-sm text-sengoku-muted">{label}</p>
          <ChevronRightIcon className="h-4 w-4 text-sengoku-gold/60" />
        </div>
        <p className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-4xl font-bold tracking-tight text-sengoku-gold">{amount}</span>
          <span className="text-base font-semibold text-sengoku-gold-soft">{unit}</span>
        </p>
        {stats.length > 0 && (
          <dl className="mt-5 grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-sengoku-muted">{s.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-sengoku-text">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {footnote && <p className="mt-3 text-xs leading-relaxed text-sengoku-faint">{footnote}</p>}
      </div>
    </section>
  );
}

function CastleSilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="currentColor" className={className} aria-hidden="true">
      <path d="M60 8 68 20H52Z" />
      <rect x="55" y="18" width="10" height="10" />
      <path d="M30 30 40 40H20Z" />
      <path d="M90 30 100 40H80Z" />
      <path d="M45 30 60 44 75 30 78 42H42Z" />
      <rect x="22" y="40" width="12" height="16" />
      <rect x="86" y="40" width="12" height="16" />
      <rect x="46" y="42" width="28" height="20" />
      <path d="M15 58 105 58 112 74H8Z" />
      <rect x="8" y="74" width="104" height="38" />
      <path d="M2 112h116v6H2Z" />
    </svg>
  );
}
