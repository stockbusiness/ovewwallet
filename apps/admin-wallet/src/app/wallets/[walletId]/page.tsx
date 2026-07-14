"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { apiFetch, ApiError } from "@/lib/api";

interface WalletDetail {
  id: string;
  walletCode: string;
  status: string;
  availableBalance: string;
  heldBalance: string;
  lifetimeCredited: string;
  lifetimeDebited: string;
  account: { accountCode: string; displayName: string | null; primaryEmail: string | null };
  holds: Array<{ id: string; amount: string; reason: string; status: string; heldAt: string }>;
  recentTransactions: Array<{
    id: string;
    transaction_code: string;
    transaction_type: string;
    direction: string;
    amount: string;
    status: string;
    display_name: string;
    occurred_at: string;
  }>;
}

export default function WalletDetailPage() {
  const params = useParams<{ walletId: string }>();
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<WalletDetail>(`/api/v1/admin/wallets/${params.walletId}`);
      setWallet(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push("/login");
    }
  }, [params.walletId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(action: "grant" | "deduct" | "hold") {
    setError(null);
    setMessage(null);
    const parsedAmount = Number(amount);
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      setError("金額は正の整数で入力してください");
      return;
    }
    if (!reason) {
      setError("理由を入力してください");
      return;
    }
    const endpoint =
      action === "grant"
        ? "/api/v1/admin/wallets/grant"
        : action === "deduct"
          ? "/api/v1/admin/wallets/deduct"
          : "/api/v1/admin/wallets/hold";
    try {
      await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ walletId: params.walletId, amount: parsedAmount, reason }),
      });
      setMessage("処理が完了しました");
      setAmount("");
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "処理に失敗しました");
    }
  }

  async function releaseHold(holdId: string) {
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/holds/${holdId}/release`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保留解除に失敗しました");
    }
  }

  if (!wallet) return <p className="p-6 text-sm text-neutral-500">読み込み中...</p>;

  return (
    <div>
      <AdminNav />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-1 text-xl font-bold">{wallet.walletCode}</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {wallet.account.accountCode} ・ {wallet.account.displayName ?? wallet.account.primaryEmail ?? "-"} ・ 状態: {wallet.status}
        </p>

        <div className="mb-6 grid grid-cols-4 gap-4 text-sm">
          <Stat label="利用可能残高" value={wallet.availableBalance} />
          <Stat label="保留残高" value={wallet.heldBalance} />
          <Stat label="累計獲得" value={wallet.lifetimeCredited} />
          <Stat label="累計利用" value={wallet.lifetimeDebited} />
        </div>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">個別付与 / 個別減算 / 残高保留</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              金額 (OVE)
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 block w-32 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              理由
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 block w-64 rounded-md border border-neutral-300 px-2 py-1 text-sm"
              />
            </label>
            <button onClick={() => runAction("grant")} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white">
              付与
            </button>
            <button onClick={() => runAction("deduct")} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white">
              減算
            </button>
            <button onClick={() => runAction("hold")} className="rounded-md bg-neutral-600 px-3 py-1.5 text-sm text-white">
              保留
            </button>
          </div>
          {message && <p className="mt-2 text-sm text-emerald-600">{message}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>

        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">保留一覧</h2>
          {wallet.holds.length === 0 && <p className="text-xs text-neutral-400">保留はありません</p>}
          <ul className="divide-y divide-neutral-100">
            {wallet.holds.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {Number(h.amount).toLocaleString("ja-JP")} OVE ・ {h.reason} ・ {h.status}
                </span>
                {h.status === "HELD" && (
                  <button onClick={() => releaseHold(h.id)} className="text-xs text-brand-600 underline">
                    保留解除
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">最近の取引</h2>
          <table className="w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="pb-1">取引コード</th>
                <th className="pb-1">種別</th>
                <th className="pb-1">金額</th>
                <th className="pb-1">状態</th>
                <th className="pb-1">日時</th>
              </tr>
            </thead>
            <tbody>
              {wallet.recentTransactions.map((t) => (
                <tr key={t.id} className="border-t border-neutral-100">
                  <td className="py-1">{t.transaction_code}</td>
                  <td className="py-1">{t.display_name}</td>
                  <td className="py-1">
                    {t.direction === "CREDIT" ? "+" : "-"}
                    {Number(t.amount).toLocaleString("ja-JP")}
                  </td>
                  <td className="py-1">{t.status}</td>
                  <td className="py-1">{new Date(t.occurred_at).toLocaleString("ja-JP")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 font-bold text-brand-700">{Number(value).toLocaleString("ja-JP")} OVE</p>
    </div>
  );
}
