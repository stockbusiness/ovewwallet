import type { CollectibleImageIngestStatus } from "@/lib/api";

/**
 * 直近の取り込み失敗 (docs/collectible-images.md)。
 * 原因を運用者が読めるようにするためで、利用者の画面には出さない。
 */
export default function CollectibleImageFailures({
  failures,
}: {
  failures: CollectibleImageIngestStatus["recentFailures"];
}) {
  if (failures.length === 0) {
    return (
      <section className="rounded border border-sengoku-border p-4">
        <h2 className="mb-2 text-sm font-semibold">直近の失敗</h2>
        <p className="text-xs text-sengoku-muted">失敗している画像はありません。</p>
      </section>
    );
  }

  return (
    <section className="rounded border border-sengoku-border p-4">
      <h2 className="mb-2 text-sm font-semibold">直近の失敗</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-sengoku-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">取得元URL</th>
              <th className="py-1 pr-3 font-normal">試行</th>
              <th className="py-1 pr-3 font-normal">最終試行</th>
              <th className="py-1 font-normal">理由</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((failure) => (
              <tr key={failure.sourceUrl} className="border-t border-sengoku-border align-top">
                <td className="py-1 pr-3 break-all">{failure.sourceUrl}</td>
                <td className="py-1 pr-3 whitespace-nowrap">{failure.attemptCount}</td>
                <td className="py-1 pr-3 whitespace-nowrap text-sengoku-muted">
                  {failure.lastAttemptAt
                    ? new Date(failure.lastAttemptAt).toLocaleString("ja-JP")
                    : "-"}
                </td>
                <td className="py-1 break-all text-sengoku-muted">{failure.lastError ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
