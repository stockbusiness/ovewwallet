import { THEME_INIT_SCRIPT } from "@ove/shared-ui";
import type { Metadata } from "next";
// フォントは **npmパッケージから自己ホスト** する (@fontsource)。
// 以前は next/font/google を使っていたが、ビルド時にGoogle Fontsへ取りに行くため、
// その取得が失敗するとビルドごと落ちる。実際にプレビュービルドで2度発生しており
// (PR #98 / #103)、本番ビルドで起きれば公開が止まる。外部通信を無くして防ぐ。
//
// 読み込むのは **latinサブセットのみ**。next/font 時代の `subsets: ["latin"]` と
// 同じ範囲で、見た目を変えないため (日本語グリフは従来どおり端末のフォントが出る)。
import "@fontsource/noto-sans-jp/latin-400.css";
import "@fontsource/noto-sans-jp/latin-500.css";
import "@fontsource/noto-sans-jp/latin-700.css";
import "@fontsource/noto-sans-jp/latin-900.css";
import "@fontsource/noto-serif-jp/latin-600.css";
import "@fontsource/noto-serif-jp/latin-700.css";
import "@fontsource/noto-serif-jp/latin-900.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "千ノ国ウォレット管理画面",
  description: "千ノ国ウォレット管理者向け画面",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
