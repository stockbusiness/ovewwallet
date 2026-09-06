"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import SupportInquiryCard from "@/components/SupportInquiryCard";
import {
  apiFetch,
  ApiError,
  SUPPORT_STATUS_LABEL,
  type SupportInquiryItem,
  type SupportInquiryStatus,
} from "@/lib/api";

const FILTERS: (SupportInquiryStatus | "")[] = ["", "OPEN", "IN_PROGRESS", "ANSWERED", "CLOSED"];

/** 利用者からの問い合わせ (docs/support-inquiries.md)。 */
export default function SupportInquiriesPage() {
  const router = useRouter();
  const [items, setItems] = useState<SupportInquiryItem[]>([]);
  const [status, setStatus] = useState<SupportInquiryStatus | "">("OPEN");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = status ? `?status=${status}` : "";
      setItems(await apiFetch<SupportInquiryItem[]>(`/api/v1/admin/support-inquiries${query}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }, [router, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">お問い合わせ</h1>
      <p className="mb-4 text-xs text-sengoku-muted">
        利用者がウォレットから送った問い合わせです。返信すると、その方だけに見える
        お知らせが1件作られます。
      </p>

      <HelpPanel storageKey="support-inquiries" title="このページについて">
        <div>
          <p className="font-semibold text-sengoku-text">アカウントは特定済みです</p>
          <p>
            本人がログインしたまま送るため、<strong>どなたの問い合わせかは確定しています。</strong>
            アカウント番号から取引履歴・残高をそのまま調べられます。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">返信は「お知らせ」で届きます</p>
          <p>
            返信用の仕組みを別に作っていません。利用者から見ると、普段のお知らせと同じ
            場所に届きます。<strong>退会済みの方へは返信できません</strong> (読まれないため)。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">運用メモは利用者に見えません</p>
          <p>調査の経過を残す欄です。返信本文とは別に保存されます。</p>
        </div>
      </HelpPanel>

      {error && <p className="mb-3 rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>}
      {message && <p className="mb-3 rounded bg-green-950 p-2 text-sm text-green-300">{message}</p>}

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value || "ALL"}
            type="button"
            onClick={() => setStatus(value)}
            className={`rounded border px-3 py-1 text-xs ${
              status === value
                ? "border-sengoku-accent text-sengoku-accent"
                : "border-sengoku-border text-sengoku-muted"
            }`}
          >
            {value ? SUPPORT_STATUS_LABEL[value] : "すべて"}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded border border-sengoku-border p-4 text-sm text-sengoku-muted">
          該当する問い合わせはありません。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <SupportInquiryCard
              key={item.id}
              inquiry={item}
              onDone={async (text) => {
                setMessage(text);
                await load();
              }}
              onError={setError}
            />
          ))}
        </div>
      )}
    </>
  );
}
