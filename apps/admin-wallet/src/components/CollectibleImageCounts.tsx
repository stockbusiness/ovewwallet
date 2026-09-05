import type { CollectibleImageIngestStatus } from "@/lib/api";

/**
 * カード画像の取り込み状況の内訳 (docs/collectible-images.md)。
 * ページ側の見通しを保つため切り出している。
 */
export default function CollectibleImageCounts({
  counts,
  maxAttempts,
}: {
  counts: CollectibleImageIngestStatus["counts"];
  maxAttempts: number;
}) {
  const items: { label: string; value: number; note: string; warn: boolean }[] = [
    {
      label: "取り込み済み",
      value: counts.stored,
      note: "ウォレットから配信しています",
      warn: false,
    },
    {
      label: "取り込み待ち",
      value: counts.pending,
      note: "次の実行で取得します",
      warn: false,
    },
    {
      label: "失敗 (再試行する)",
      value: counts.failed,
      note: `${maxAttempts}回まで自動で試します`,
      warn: counts.failed > 0,
    },
    {
      label: "打ち切り",
      value: counts.exhausted,
      note: "自動では戻りません",
      warn: counts.exhausted > 0,
    },
    {
      label: "取り込み対象外",
      value: counts.unregistered,
      note: "対象へ入っていないURL",
      warn: counts.unregistered > 0,
    },
  ];

  return (
    <section className="mb-6 grid gap-2 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded border border-sengoku-border p-3">
          <p className="text-xs text-sengoku-muted">{item.label}</p>
          <p className={`text-xl font-bold ${item.warn ? "text-yellow-400" : "text-sengoku-text"}`}>
            {item.value}
          </p>
          <p className="mt-1 text-[11px] text-sengoku-muted">{item.note}</p>
        </div>
      ))}
    </section>
  );
}
