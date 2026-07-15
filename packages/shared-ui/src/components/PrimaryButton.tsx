"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  href?: string;
  fullWidth?: boolean;
}

const BASE_CLASSES =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-5 py-3 text-base font-bold text-white bg-sengoku-red transition-colors hover:bg-[#96181f] active:bg-[#7d141a] disabled:cursor-not-allowed disabled:opacity-50";

/** 重要操作 (ログイン確定・送信・付与実行など) 用のプライマリボタン。深紅を使用する。 */
export function PrimaryButton({ children, href, fullWidth, className = "", ...props }: PrimaryButtonProps) {
  const classes = `${BASE_CLASSES} ${fullWidth ? "w-full" : ""} ${className}`.trim();
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
