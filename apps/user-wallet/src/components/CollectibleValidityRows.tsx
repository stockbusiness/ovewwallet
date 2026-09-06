import type { CollectibleHoldingSummary } from "@/lib/api";

/** 期限切れの帯。使えるつもりで持ち歩かせないよう、目立つ位置に出す。 */
export function CollectibleExpiredBanner({ item }: { item: CollectibleHoldingSummary }) {
  if (!item.is_expired) return null;
  return (
    <p className="rounded-xl bg-red-950 p-3 text-center text-sm font-bold text-red-300">
      有効期限が切れています
    </p>
  );
}

/**
 * 会員券の有効期間の行 (docs/collectible-multi-market.md)。
 * 詳細ページの見通しを保つため切り出している。
 */
export default function CollectibleValidityRows({
  item,
  Row,
}: {
  item: CollectibleHoldingSummary;
  Row: (props: { label: string; value: string }) => React.ReactElement;
}) {
  if (item.kind !== "MEMBERSHIP_PASS") return null;

  return (
    <>
      {item.valid_from && (
        <Row
          label="有効期間の開始"
          value={new Date(item.valid_from).toLocaleString("ja-JP")}
        />
      )}
      <Row
        label="有効期限"
        value={item.valid_to ? new Date(item.valid_to).toLocaleString("ja-JP") : "なし"}
      />
    </>
  );
}
