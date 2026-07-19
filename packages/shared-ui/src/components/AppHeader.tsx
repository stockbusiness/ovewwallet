import type { ReactNode } from "react";
import { WalletLogo } from "./WalletLogo";

export interface AppHeaderProps {
  /** ヘッダー右側に表示する要素 (通知ベルなど)。省略時は何も出さない。 */
  right?: ReactNode;
}

/** 「千ノ国ウォレット」ブランドロゴを左上に据えるアプリ共通ヘッダー。 */
export function AppHeader({ right }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 pb-4 pt-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sengoku-gold/70 bg-gradient-to-br from-sengoku-navy to-sengoku-navy-deep text-sengoku-gold">
          <WalletLogo className="h-6 w-6" />
        </span>
        <p className="font-heading text-base font-bold leading-none text-sengoku-text">千ノ国ウォレット</p>
      </div>
      {right}
    </header>
  );
}
