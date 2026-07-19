import Link from "next/link";

export interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  actionHref?: string;
}

/** 「最近の取引」「お知らせ」などのセクション見出し。右端に任意の「すべて見る」導線を出す。 */
export function SectionHeader({ title, actionLabel, actionHref }: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-bold text-sengoku-text">{title}</h2>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="text-xs font-semibold text-sengoku-gold">
          {actionLabel} ›
        </Link>
      )}
    </div>
  );
}
