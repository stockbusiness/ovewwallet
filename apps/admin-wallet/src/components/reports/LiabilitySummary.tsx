import { formatOve, type CurrentLiability } from "@/lib/point-liability";

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
      <p className="text-xs text-sengoku-muted">{label}</p>
      <p className="mt-1 font-heading text-2xl font-bold text-sengoku-gold">{value}</p>
      {note && <p className="mt-1 text-xs text-sengoku-muted">{note}</p>}
    </div>
  );
}

/** 現時点の負債残高と失効見込み。 */
export function LiabilitySummary({ liability }: { liability: CurrentLiability }) {
  const total = BigInt(liability.totalBalance);
  const expiring = BigInt(liability.expiringBalance);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label="発行済み未使用残高"
          value={`${formatOve(liability.totalBalance)} ORI`}
          note={`${liability.walletsWithBalance.toLocaleString("ja-JP")} ウォレット`}
        />
        <Card label="うち利用可能" value={`${formatOve(liability.availableBalance)} ORI`} />
        <Card
          label="うち保留中"
          value={`${formatOve(liability.heldBalance)} ORI`}
          note="管理者による保留。債務としては残る"
        />
        <Card
          label="うち有効期限あり"
          value={`${formatOve(liability.expiringBalance)} ORI`}
          note={`期限なし ${formatOve((total - expiring).toString())} ORI`}
        />
      </div>

      <h2 className="mb-3 mt-8 font-heading text-lg font-bold">失効見込み</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {liability.expiryForecast.map((bucket) => (
          <Card
            key={bucket.withinDays}
            label={`${bucket.withinDays}日以内に失効`}
            value={`${formatOve(bucket.amount)} ORI`}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-sengoku-muted">
        集計時刻: {new Date(liability.asOf).toLocaleString("ja-JP")}
      </p>
    </>
  );
}
