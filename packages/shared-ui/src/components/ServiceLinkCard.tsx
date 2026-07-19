import Link from "next/link";
import type { ReactNode } from "react";

export interface ServiceLinkCardProps {
  icon: ReactNode;
  label: string;
  href?: string;
  disabled?: boolean;
}

/**
 * ウォレットホームのクイックアクション (貯める/使う/取引履歴/連携サービスなど) や、
 * 連携中の外部サービスを表す正方形寄りのカード。
 */
export function ServiceLinkCard({ icon, label, href, disabled }: ServiceLinkCardProps) {
  const iconColor = disabled ? "text-sengoku-faint" : "text-sengoku-gold";
  const labelColor = disabled ? "text-sengoku-faint" : "text-sengoku-text";
  const classes =
    "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-sengoku-border bg-sengoku-navy px-2 py-3.5 text-center transition-colors";

  const inner = (
    <>
      <span className={`text-xl ${iconColor}`}>{icon}</span>
      <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
      {disabled && <span className="text-[10px] text-sengoku-faint">準備中</span>}
    </>
  );

  if (disabled || !href) {
    return <div className={`${classes} opacity-70`}>{inner}</div>;
  }
  return (
    <Link href={href} className={`${classes} hover:border-sengoku-gold/60 active:bg-sengoku-text/10`}>
      {inner}
    </Link>
  );
}
