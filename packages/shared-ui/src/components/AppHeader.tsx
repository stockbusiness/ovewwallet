import type { ReactNode } from "react";

export interface AppHeaderProps {
  /** ヘッダー右側に表示する要素 (通知ベルなど)。省略時は何も出さない。 */
  right?: ReactNode;
}

/** 「戦国WALLET」ブランドロゴを左上に据えるアプリ共通ヘッダー。 */
export function AppHeader({ right }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 pb-4 pt-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sengoku-gold/70 bg-gradient-to-br from-sengoku-navy to-black text-sengoku-gold">
          <KabutoMark className="h-5 w-5" />
        </span>
        <p className="font-heading leading-none text-white">
          <span className="text-lg font-bold tracking-wide">戦国</span>
          <span className="ml-1 text-[11px] font-semibold tracking-[0.2em] text-sengoku-gold">WALLET</span>
        </p>
      </div>
      {right}
    </header>
  );
}

function KabutoMark(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={props.className}>
      <path d="M12 2c1.4 1.6 3.2 2.4 5.4 2.4-.2 1-.7 1.7-1.5 2.2 1.6.9 2.6 2.5 2.6 4.6 0 .6-.4 1-1 1h-1.1c.3 1 .1 2-.6 2.8-1 .1-2.4.2-3.8.2h-4c-1.4 0-2.8-.1-3.8-.2-.7-.8-.9-1.8-.6-2.8H4.5c-.6 0-1-.4-1-1 0-2.1 1-3.7 2.6-4.6-.8-.5-1.3-1.2-1.5-2.2C6.8 4.4 8.6 3.6 10 2c.6.4 1.4.4 2 0Z" />
      <path d="M9 16.4c.3 1.6 1.3 2.6 3 2.6s2.7-1 3-2.6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
