import type { StatusTone } from "../transaction-status";

export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-sengoku-gold text-sengoku-navy",
  warning: "border border-sengoku-gold text-sengoku-gold bg-transparent",
  danger: "bg-sengoku-red text-white",
  neutral: "border border-sengoku-border text-sengoku-muted bg-transparent",
};

/** 取引・申請などの状態を表す小さなピル。深紅は「重要/要注意」の状態にのみ使う。 */
export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  );
}
