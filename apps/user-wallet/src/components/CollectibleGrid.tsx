import Link from "next/link";
import { CollectibleCardImage } from "@/components/CollectibleCardImage";
import type { CollectibleHoldingSummary } from "@/lib/api";
import { collectibleStatusLabel } from "@/lib/collectible-status";

/**
 * 保有一覧のグリッド (docs/collectible-multi-market.md)。
 * ページ側の見通しを保つため切り出している。
 */
export default function CollectibleGrid({ items }: { items: CollectibleHoldingSummary[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => {
        const label = collectibleStatusLabel(item.status);
        return (
          <Link
            key={item.holding_id}
            href={`/wallet/collection/${item.holding_id}`}
            className="overflow-hidden rounded-xl border border-sengoku-border bg-sengoku-navy"
          >
            <div className="relative aspect-square w-full">
              <CollectibleCardImage
                src={item.asset.thumbnail_url ?? item.asset.image_url}
                alt={item.asset.name}
              />
              {/* 期限切れは絵の上に出す。一覧で気づけないと、使えるつもりで持ち歩くことになる。 */}
              {item.is_expired && (
                <span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-[10px] font-bold text-white">
                  期限切れ
                </span>
              )}
            </div>
            <div className="p-2">
              <p className="truncate text-sm font-semibold text-sengoku-text">{item.asset.name}</p>
              {item.serial_number && (
                <p className="mt-0.5 text-[10px] text-sengoku-faint">#{item.serial_number}</p>
              )}
              <p className="mt-1 text-[10px] text-sengoku-muted">{label.primary}</p>
              {item.valid_to && (
                <p className="mt-0.5 text-[10px] text-sengoku-faint">
                  {new Date(item.valid_to).toLocaleDateString("ja-JP")}まで
                </p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
