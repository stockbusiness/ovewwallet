import type { AccountDetailItem } from "@/lib/api";

/** アカウント詳細の「このアカウントに関する操作ログ」欄。 */
export default function AccountAuditLogsSection({
  auditLogs,
}: {
  auditLogs: AccountDetailItem["auditLogs"];
}) {
  return (
    <section className="rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
      <h2 className="mb-3 text-sm font-semibold">このアカウントに関する操作ログ</h2>
      {auditLogs.length === 0 && <p className="text-xs text-sengoku-faint">操作ログはありません</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs [&_th]:whitespace-nowrap">
          <thead className="text-sengoku-muted">
            <tr>
              <th className="pb-1">日時</th>
              <th className="pb-1">操作</th>
              <th className="pb-1">結果</th>
              <th className="pb-1">理由</th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((l) => (
              <tr key={l.id} className="border-t border-sengoku-border">
                <td className="py-1">{new Date(l.createdAt).toLocaleString("ja-JP")}</td>
                <td className="py-1">{l.actionType}</td>
                <td className="py-1">
                  <span className={l.result === "SUCCESS" ? "text-sengoku-green" : "text-sengoku-red"}>
                    {l.result}
                  </span>
                </td>
                <td className="py-1">{l.reason ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
