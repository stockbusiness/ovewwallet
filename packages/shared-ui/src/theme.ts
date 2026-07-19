/// <reference lib="dom" />

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ove-theme";

/**
 * <head>内で最初に同期実行するスクリプト。ハイドレーション前にdata-theme属性を
 * 確定させ、ページ読み込み時にテーマが一瞬切り替わる (FOUC) のを防ぐ。
 * 保存済みの選択が無ければOSの配色設定に従う。
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}";var s=localStorage.getItem(k);var t=(s==="light"||s==="dark")?s:((window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark");if(t==="light"){document.documentElement.setAttribute("data-theme","light");}}catch(e){}})();`;

export function applyTheme(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function getCurrentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
