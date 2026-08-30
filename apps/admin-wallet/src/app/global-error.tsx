"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { isSentryEnabled } from "../lib/sentry-options";

/**
 * 描画中に発生した例外の最終受け皿 (App Routerの`global-error`)。
 * ここに落ちると画面が真っ白になるため、担当者への案内を出しつつSentryへ送る。
 * ルートレイアウトごと置き換わるので`html`/`body`を自前で描画する必要があり、
 * globals.cssも読み込まれないため配色はインラインで指定する。
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (isSentryEnabled()) Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          background: "#0A1E3F",
          color: "#FFFFFF",
          fontFamily:
            '"Noto Sans JP", -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif',
        }}
      >
        <main style={{ maxWidth: "26rem", textAlign: "center", lineHeight: 1.8 }}>
          <h1 style={{ fontSize: "1.15rem", margin: "0 0 .75rem", color: "#C8A45A" }}>
            画面を表示できませんでした
          </h1>
          <p style={{ margin: "0 0 1.5rem", fontSize: ".9rem", color: "#D1D5DB" }}>
            一時的な問題が発生しました。この画面で行おうとした操作は実行されていません。
            再読み込みしても解決しない場合は、エラー発生時刻を控えて開発担当へ連絡してください。
          </p>
          {error.digest ? (
            <p style={{ margin: "0 0 1.5rem", fontSize: ".75rem", color: "#949EAD" }}>
              エラーID: <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              width: "100%",
              padding: ".8rem 1rem",
              fontSize: ".95rem",
              fontWeight: 700,
              color: "#0A1E3F",
              background: "#C8A45A",
              border: "none",
              borderRadius: ".5rem",
              cursor: "pointer",
            }}
          >
            再読み込み
          </button>
        </main>
      </body>
    </html>
  );
}
