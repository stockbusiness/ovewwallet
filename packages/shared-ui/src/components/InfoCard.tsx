import Link from "next/link";

export interface InfoCardProps {
  title: string;
  message: string;
  date?: string;
  actionLabel?: string;
  actionHref?: string;
  /** 重要なお知らせの場合、深紅の枠線で強調する */
  important?: boolean;
  /** 未読の場合、タイトル左に丸印を表示する */
  unread?: boolean;
}

/** 「お知らせ」など、見出し+本文+日付を1件だけ見せる案内カード。 */
export function InfoCard({ title, message, date, actionLabel, actionHref, important, unread }: InfoCardProps) {
  return (
    <section
      className={`rounded-xl border bg-sengoku-navy p-4 ${important ? "border-sengoku-red" : "border-sengoku-border"}`}
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-sengoku-text">
          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sengoku-red" aria-hidden />}
          {important && <span className="text-xs font-bold text-sengoku-red">【重要】</span>}
          {title}
        </h2>
        {actionLabel && actionHref && (
          <Link href={actionHref} className="text-xs font-semibold text-sengoku-gold">
            {actionLabel} ›
          </Link>
        )}
      </div>
      <p className="mt-2 text-sm text-sengoku-muted">{message}</p>
      {date && <p className="mt-1 text-xs text-sengoku-faint">{date}</p>}
    </section>
  );
}
