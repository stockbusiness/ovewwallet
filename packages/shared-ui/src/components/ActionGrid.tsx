"use client";

import Link from "next/link";
import { useState } from "react";
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
  const [toast, setToast] = useState<string | null>(null);

  function showComingSoon(label: string) {
    setToast(`${label}は準備中です`);
    window.setTimeout(() => setToast(null), 1800);
  }

  return (
    <div className="relative">
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 -top-2 z-30 flex -translate-y-full justify-center">
          <div className="rounded-full bg-sengoku-ink px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/30">
            {toast}
          </div>
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => {
          const disabled = item.disabled || !item.href;
          const inner = (
            <>
              <span className={disabled ? "text-sengoku-faint" : "text-sengoku-gold"}>{item.icon}</span>
              <span className={`text-[11px] font-semibold ${disabled ? "text-sengoku-faint" : "text-sengoku-text"}`}>{item.label}</span>
            </>
          );
          const classes = "flex w-full flex-col items-center gap-2 rounded-lg py-2 text-center transition-colors";
          if (disabled) {
            return (
              <button
                key={item.label}
                type="button"
                className={`${classes} opacity-60`}
                onClick={() => showComingSoon(item.label)}
              >
                {inner}
              </button>
            );
          }
          return (
            <Link key={item.label} href={item.href!} className={`${classes} active:bg-sengoku-text/5`}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
