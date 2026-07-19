"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AuthButtonVariant = "line" | "email" | "sengoku";

export interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant: AuthButtonVariant;
  icon?: ReactNode;
}

// これらは千ノ国パスポート/LINE/メールいずれもブランド上「常にこの配色」の指定
// (仕様書5章)であり、ライト/ダークテーマの影響を受けない固定色で統一する。
const VARIANT_CLASSES: Record<AuthButtonVariant, string> = {
  line: "bg-[#06C755] text-white hover:bg-[#05b34c] active:bg-[#049a42]",
  email: "bg-white text-sengoku-ink border border-black/10 hover:bg-white/90 active:bg-white/85",
  sengoku: "bg-sengoku-ink text-white border border-sengoku-gold/40 hover:bg-white/5 active:bg-white/10",
};

const ICON_WRAP_CLASSES: Record<AuthButtonVariant, string> = {
  line: "bg-white text-[#06C755]",
  email: "bg-sengoku-ink text-white",
  sengoku: "bg-transparent text-sengoku-gold",
};

/** ログイン画面の認証手段選択ボタン (LINE=緑/メール=白/千ノ国パスポート=藍)。常に横幅いっぱいのピル型。 */
export function AuthButton({ children, variant, icon, className = "", ...props }: AuthButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-[52px] w-full items-center justify-center gap-3 rounded-full px-6 text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`.trim()}
      {...props}
    >
      {icon && (
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ICON_WRAP_CLASSES[variant]}`}>
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
