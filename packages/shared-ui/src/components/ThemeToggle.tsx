"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "../icons";
import { applyTheme, getCurrentTheme, type Theme } from "../theme";

/** ダーク/ライトのテーマ切替ボタン。押した瞬間にdata-theme属性とlocalStorageを更新する。 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(getCurrentTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "ライトモードに切り替える" : "ダークモードに切り替える"}
      className={`flex h-9 w-9 items-center justify-center rounded-full border border-sengoku-border text-sengoku-muted transition-colors hover:text-sengoku-gold ${className}`}
    >
      {theme === "dark" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
