import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OVEウォレット管理画面",
  description: "OVEウォレット管理者向け画面",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
