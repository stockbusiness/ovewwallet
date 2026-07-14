import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OVEウォレット",
  description: "戦国パスポート・AIアート教室などから共通利用されるOVE残高管理基盤",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">
        <div className="mx-auto max-w-md min-h-screen bg-white shadow-sm">{children}</div>
      </body>
    </html>
  );
}
