import Link from "next/link";
import type { ReactNode } from "react";

export interface ActionGridItem {
  icon: ReactNode;
  label: string;
  href?: string;
  disabled?: boolean;
}

export interface ActionGridProps {
  items: ActionGridItem[];
}

/** ウォレットホームの主要アクション(貯める/使う/取引履歴/連携サービス)を並べる4列グリッド。 */
export function ActionGrid({ items }: ActionGridProps) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((item) => {
        const disabled = item.disabled || !item.href;
        const inner = (
          <>
            <span className={disabled ? "text-sengoku-faint" : "text-sengoku-gold"}>{item.icon}</span>
            <span className={`text-[11px] font-semibold ${disabled ? "text-sengoku-faint" : "text-sengoku-text"}`}>{item.label}</span>
          </>
        );
        const classes = "flex flex-col items-center gap-2 rounded-lg py-2 text-center transition-colors";
        if (disabled) {
          return (
            <div key={item.label} className={`${classes} opacity-60`}>
              {inner}
            </div>
          );
        }
        return (
          <Link key={item.label} href={item.href!} className={`${classes} active:bg-sengoku-text/5`}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
