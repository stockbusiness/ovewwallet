import Link from "next/link";

export interface InfoCardProps {
  title: string;
  message: string;
  date?: string;
  actionLabel?: string;
  actionHref?: string;
}

/** 「お知らせ」など、見出し+本文+日付を1件だけ見せる案内カード。 */
export function InfoCard({ title, message, date, actionLabel, actionHref }: InfoCardProps) {
  return (
    <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">{title}</h2>
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
