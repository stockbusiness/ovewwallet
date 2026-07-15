"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface SecondaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  href?: string;
  fullWidth?: boolean;
  tone?: "gold" | "neutral";
}

const TONE_CLASSES: Record<NonNullable<SecondaryButtonProps["tone"]>, string> = {
  gold: "border-sengoku-gold text-sengoku-gold hover:bg-sengoku-gold/10 active:bg-sengoku-gold/15",
  neutral: "border-sengoku-border text-white hover:bg-white/5 active:bg-white/10",
};

const BASE_CLASSES =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border-2 bg-transparent px-5 py-3 text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** 補助操作 (別ログイン手段・キャンセルなど) 用のセカンダリボタン。金の縁取りが標準。 */
export function SecondaryButton({
  children,
  href,
  fullWidth,
  tone = "gold",
  className = "",
  ...props
}: SecondaryButtonProps) {
  const classes = `${BASE_CLASSES} ${TONE_CLASSES[tone]} ${fullWidth ? "w-full" : ""} ${className}`.trim();
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
