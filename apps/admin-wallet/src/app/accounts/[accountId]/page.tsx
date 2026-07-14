"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError, type AccountDetailItem } from "@/lib/api";

export default function AccountDetailPage() {
  const params = useParams<{ accountId: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<AccountDetailItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<AccountDetailItem>(`/api/v1/admin/accounts/${params.accountId}`);
        setAccount(data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.push("/login");
        else if (err instanceof ApiError && err.status === 404) setError("アカウントが見つかりません");
      }
    })();
  }, [params.accountId, router]);

  if (error) {
    return (
      <div>
        <AdminNav />
        <main className="mx-auto max-w-4xl p-6">
          <p className="text-sm text-red-600">{error}</p>
        </main>
      </div>
    );
  }

  if (!account) return <p className="p-6 text-sm text-neutral-500">読み込み中...</p>;

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-1 text-xl font-bold">{account.accountCode}</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {account.displayName ?? account.primaryEmail ?? "-"} ・ 状態: {account.status} ・ 登録日:{" "}
          {new Date(account.createdAt).toLocaleDateString("ja-JP")}
        </p>

        {account.mergedIntoAccount && (
          <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-700">
            このアカウントは{" "}
            <Link href={`/accounts/${account.mergedIntoAccount.id}`} className="underline">
              {account.mergedIntoAccount.accountCode}
            </Link>{" "}
            に統合済みです。
          </p>
        )}

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">基本情報</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-neutral-500">メールアドレス</dt>
              <dd>{account.primaryEmail ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">電話番号</dt>
              <dd>{account.primaryPhone ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">本人確認レベル</dt>
              <dd>{account.verificationLevel}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">ウォレット</dt>
              <dd>
                {account.wallet ? (
                  <Link href={`/wallets/${account.wallet.id}`} className="text-brand-600 underline">
                    {account.wallet.walletCode} (
                    {Number(account.wallet.availableBalance).toLocaleString("ja-JP")} OVE)
                  </Link>
                ) : (
                  "未作成"
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">連携ID (ログイン手段)</h2>
          {account.identities.length === 0 && <p className="text-xs text-neutral-400">連携IDはありません</p>}
          <table className="w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="pb-1">種別</th>
                <th className="pb-1">プロバイダ</th>
                <th className="pb-1">メール</th>
                <th className="pb-1">状態</th>
                <th className="pb-1">登録日</th>
              </tr>
            </thead>
            <tbody>
              {account.identities.map((i) => (
                <tr key={i.id} className="border-t border-neutral-100">
                  <td className="py-1">{i.identityType}</td>
                  <td className="py-1">{i.provider}</td>
                  <td className="py-1">{i.email ?? "-"}</td>
                  <td className="py-1">{i.status}</td>
                  <td className="py-1">{new Date(i.createdAt).toLocaleDateString("ja-JP")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">外部サービス連携</h2>
          {account.links.length === 0 && <p className="text-xs text-neutral-400">外部サービス連携はありません</p>}
          <table className="w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="pb-1">サービス</th>
                <th className="pb-1">外部ユーザーID</th>
                <th className="pb-1">連携方法</th>
                <th className="pb-1">状態</th>
                <th className="pb-1">連携日</th>
              </tr>
            </thead>
            <tbody>
              {account.links.map((l) => (
                <tr key={l.id} className="border-t border-neutral-100">
                  <td className="py-1">{l.serviceIntegration.serviceCode}</td>
                  <td className="py-1">{l.externalUserId}</td>
                  <td className="py-1">{l.linkMethod}</td>
                  <td className="py-1">{l.status}</td>
                  <td className="py-1">{new Date(l.linkedAt).toLocaleDateString("ja-JP")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">このアカウントに関する操作ログ</h2>
          {account.auditLogs.length === 0 && <p className="text-xs text-neutral-400">操作ログはありません</p>}
          <table className="w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="pb-1">日時</th>
                <th className="pb-1">操作</th>
                <th className="pb-1">結果</th>
                <th className="pb-1">理由</th>
              </tr>
            </thead>
            <tbody>
              {account.auditLogs.map((l) => (
                <tr key={l.id} className="border-t border-neutral-100">
                  <td className="py-1">{new Date(l.createdAt).toLocaleString("ja-JP")}</td>
                  <td className="py-1">{l.actionType}</td>
                  <td className="py-1">
                    <span className={l.result === "SUCCESS" ? "text-emerald-600" : "text-red-600"}>{l.result}</span>
                  </td>
                  <td className="py-1">{l.reason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
