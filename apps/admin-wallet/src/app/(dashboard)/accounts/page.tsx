"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, API_BASE_URL, type AccountListItem } from "@/lib/api";

const STATUS_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "PENDING", label: "PENDING" },
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "RESTRICTED", label: "RESTRICTED" },
  { value: "REVIEWING", label: "REVIEWING" },
  { value: "LOCKED", label: "LOCKED" },
  { value: "CLOSED", label: "CLOSED (退会済み)" },
  { value: "MERGED", label: "MERGED" },
];

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  // 入力のたびに検索すると打鍵ごとにリクエストが飛ぶため、入力が止まってから投げる。
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "200" });
        if (status) params.set("status", status);
        if (appliedSearch) params.set("search", appliedSearch);
        const list = await apiFetch<AccountListItem[]>(`/api/v1/admin/accounts?${params.toString()}`);
        // 入力を続けている間に古いリクエストが後から届いて上書きするのを防ぐ。
        if (cancelled) return;
        setAccounts(list);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, status, appliedSearch]);

  async function downloadCsv() {
    setExporting(true);
    setError(null);
    try {
      // 画面に出ている絞り込みと同じ条件でCSVを出す (表示とCSVの内容がずれないように)。
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (appliedSearch) params.set("search", appliedSearch);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/accounts/export${query}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "accounts.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("CSVのダウンロードに失敗しました");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">アカウント一覧</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={downloadCsv}
              disabled={exporting}
              className="rounded-md border border-sengoku-border px-4 py-1.5 text-sm text-sengoku-text disabled:opacity-50"
            >
              {exporting ? "ダウンロード中..." : "CSVダウンロード"}
            </button>
            <Link href="/accounts/merge" className="text-sm text-sengoku-gold underline">
              アカウント統合
            </Link>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-[18rem] flex-1 items-center gap-2">
            <label htmlFor="account-search" className="whitespace-nowrap text-sm text-sengoku-muted">
              検索:
            </label>
            <input
              id="account-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="メールアドレス / アカウントコード / 表示名 / 電話番号 / common_user_id"
              className="w-full rounded-md border border-sengoku-border bg-sengoku-navy px-2 py-1 text-sm text-sengoku-text placeholder:text-sengoku-faint"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="status-filter" className="whitespace-nowrap text-sm text-sengoku-muted">
              状態で絞り込み:
            </label>
            <select
              id="status-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-md border border-sengoku-border px-2 py-1 text-sm"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="mb-4 text-sm text-sengoku-red">{error}</p>}
        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">アカウントコード</th>
              <th className="p-3">状態</th>
              <th className="p-3">メール</th>
              <th className="p-3">ウォレット残高</th>
              <th className="p-3">登録日</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr className="border-t border-sengoku-border">
                <td colSpan={5} className="p-6 text-center text-sm text-sengoku-muted">
                  {loading
                    ? "読み込み中..."
                    : appliedSearch
                      ? `「${appliedSearch}」に一致するアカウントは見つかりませんでした`
                      : "表示できるアカウントがありません"}
                </td>
              </tr>
            )}
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-sengoku-border">
                <td className="p-3">
                  <Link href={`/accounts/${a.id}`} className="text-sengoku-gold underline">
                    {a.accountCode}
                  </Link>
                </td>
                <td className="p-3">{a.status}</td>
                <td className="p-3">{a.primaryEmail ?? "-"}</td>
                <td className="p-3">
                  {a.wallet ? (
                    <Link href={`/wallets/${a.wallet.id}`} className="text-sengoku-gold underline">
                      {Number(a.wallet.availableBalance).toLocaleString("ja-JP")} ORI
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="p-3">{new Date(a.createdAt).toLocaleDateString("ja-JP")}</td>
              </tr>
            ))}
          </tbody>
        </table>
    </>
  );
}
