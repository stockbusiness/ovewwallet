import type { AccountDetailItem } from "@/lib/api";

/** アカウント詳細の「連携ID (ログイン手段)」欄。 */
export default function AccountIdentitiesSection({
  identities,
}: {
  identities: AccountDetailItem["identities"];
}) {
  return (
    <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
      <h2 className="mb-3 text-sm font-semibold">連携ID (ログイン手段)</h2>
      {identities.length === 0 && <p className="text-xs text-sengoku-faint">連携IDはありません</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs [&_th]:whitespace-nowrap">
          <thead className="text-sengoku-muted">
            <tr>
              <th className="pb-1">種別</th>
              <th className="pb-1">プロバイダ</th>
              <th className="pb-1">メール</th>
              <th className="pb-1">状態</th>
              <th className="pb-1">登録日</th>
            </tr>
          </thead>
          <tbody>
            {identities.map((i) => (
              <tr key={i.id} className="border-t border-sengoku-border">
                <td className="py-1">{i.identityType}</td>
                <td className="py-1">{i.provider}</td>
                <td className="py-1">{i.email ?? "-"}</td>
                <td className="py-1">{i.status}</td>
                <td className="py-1">{new Date(i.createdAt).toLocaleDateString("ja-JP")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
