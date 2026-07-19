import type { Metadata } from "next";
import { Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@ove/shared-ui";
import "./globals.css";

const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-noto-sans-jp",
  display: "swap",
});

const notoSerifJp = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["600", "700", "900"],
  variable: "--font-noto-serif-jp",
  display: "swap",
});

export const metadata: Metadata = {
  title: "戦国ウォレット (OVE)",
  description: "戦国パスポート・AIアート教室などから共通利用されるOVE残高管理基盤",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${notoSansJp.variable} ${notoSerifJp.variable}`} suppressHydrationWarning>
      <head>
        {/* ページ描画前にdata-theme属性を確定させ、テーマの一瞬の切り替わり(FOUC)を防ぐ */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-sengoku-bg font-sans text-sengoku-text" suppressHydrationWarning>
        <div className="mx-auto min-h-screen max-w-md bg-sengoku-bg">{children}</div>
      </body>
    </html>
  );
}
