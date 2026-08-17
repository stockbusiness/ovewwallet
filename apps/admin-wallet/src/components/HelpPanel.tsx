"use client";

import { useEffect, useState } from "react";

const STORAGE_PREFIX = "ove-admin-help-collapsed:";

/**
 * 各設定・連携画面の先頭に置く「このページについて」パネル。開閉状態はページごとに
 * localStorageへ保存し、一度閉じた運用担当者には次回以降表示しない(ただし常に
 * 再度開ける)。誰でも運営できるようにする目的のため、初期状態は展開。
 */
export default function HelpPanel({ storageKey, title, children }: { storageKey: string; title: string; children: React.ReactNode }) {
  const key = `${STORAGE_PREFIX}${storageKey}`;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(key) === "1");
  }, [key]);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(key, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="mb-6 rounded-lg border border-sengoku-gold/30 bg-sengoku-gold/5">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-sengoku-gold"
      >
        <span>📖 {title}</span>
        <span className="text-xs text-sengoku-faint">{collapsed ? "開く" : "閉じる"}</span>
      </button>
      {!collapsed && <div className="space-y-3 border-t border-sengoku-gold/20 px-4 py-4 text-sm text-sengoku-muted">{children}</div>}
    </div>
  );
}
