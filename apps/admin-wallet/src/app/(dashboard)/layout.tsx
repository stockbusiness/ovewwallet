import Sidebar from "@/components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-sengoku-bg text-sengoku-text">
      <Sidebar />
      {/*
       * スマートフォンではサイドバーが画面外へ退避し、代わりに高さ14 (56px) の固定
       * ヘッダーが載るため、その分だけ上を空ける。左右の余白もmdより狭くして、
       * 狭い画面で本文に使える幅を稼ぐ。
       */}
      <main className="min-w-0 flex-1 overflow-x-auto px-4 pb-8 pt-[4.5rem] md:px-6 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
