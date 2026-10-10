import type { AccountDetailItem } from "@/lib/api";

/** アカウント詳細の「外部サービス連携」欄。 */
export default function AccountLinksSection({ links }: { links: AccountDetailItem["links"] }) {
  return (
    <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
      <h2 className="mb-3 text-sm font-semibold">外部サービス連携</h2>
      {links.length === 0 && <p className="text-xs text-sengoku-faint">外部サービス連携はありません</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs [&_th]:whitespace-nowrap">
          <thead className="text-sengoku-muted">
            <tr>
              <th className="pb-1">サービス</th>
              <th className="pb-1">外部ユーザーID</th>
              <th className="pb-1">連携方法</th>
              <th className="pb-1">状態</th>
              <th className="pb-1">連携日</th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id} className="border-t border-sengoku-border">
                <td className="py-1">{l.serviceIntegration.serviceCode}</td>
                <td className="py-1">{l.externalUserId}</td>
                <td className="py-1">{l.linkMethod}</td>
                <td className="py-1">{l.status}</td>
                <td className="py-1">{new Date(l.linkedAt).toLocaleDateString("ja-JP")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
