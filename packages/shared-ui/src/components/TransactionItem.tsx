import Link from "next/link";
import type { ReactNode } from "react";

export interface TransactionItemProps {
  icon?: ReactNode;
  title: string;
  subtitle: string;
  amount: string | number;
  direction: "CREDIT" | "DEBIT";
  unit?: string;
  href?: string;
}

/** 取引一覧・ウォレットホームの「最近の取引」で使う1行。獲得は緑、利用は深紅で表示する。 */
export function TransactionItem({ icon, title, subtitle, amount, direction, unit = "OVE", href }: TransactionItemProps) {
  const formatted = `${direction === "CREDIT" ? "+" : "-"}${Number(amount).toLocaleString("ja-JP")}`;
  const isCredit = direction === "CREDIT";
  const amountColor = isCredit ? "text-sengoku-green" : "text-sengoku-red";
  const iconClasses = isCredit ? "bg-sengoku-green/15 text-sengoku-green" : "bg-sengoku-red/15 text-sengoku-red";

  const content = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClasses}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-sengoku-text">{title}</p>
        <p className="mt-0.5 truncate text-xs text-sengoku-muted">{subtitle}</p>
      </div>
      <span className={`shrink-0 text-right text-sm font-bold ${amountColor}`}>
        {formatted}
        <span className="ml-0.5 text-xs font-medium">{unit}</span>
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block transition-colors hover:bg-sengoku-text/5 active:bg-sengoku-text/10">
        {content}
      </Link>
    );
  }
  return content;
}
