"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface BottomNavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** trueの場合リンクを無効化し「準備中」として表示する。 */
  disabled?: boolean;
  /** アクティブ判定をpathname完全一致ではなく前方一致にしたい場合。 */
  matchPrefix?: boolean;
}

export interface BottomNavigationProps {
  items: BottomNavItem[];
}

/** スマートフォン画面下部に固定するナビゲーション。375px幅を基準にした5項目まで想定。 */
export function BottomNavigation({ items }: BottomNavigationProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="フッターナビゲーション"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-sengoku-border bg-sengoku-surface/97 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-between">
        {items.map((item) => {
          const active = item.matchPrefix ? pathname?.startsWith(item.href) : pathname === item.href;
          const textColor = item.disabled ? "text-sengoku-faint" : active ? "text-sengoku-gold" : "text-sengoku-muted";
          const body = (
            <div className={`flex flex-col items-center gap-0.5 px-1 py-2.5 text-[11px] font-medium ${textColor}`}>
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </div>
          );
          if (item.disabled) {
            return (
              <li key={item.label} className="flex-1 text-center">
                {body}
              </li>
            );
          }
          return (
            <li key={item.label} className="flex-1 text-center">
              <Link href={item.href} aria-current={active ? "page" : undefined}>
                {body}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
