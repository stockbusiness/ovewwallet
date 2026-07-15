"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  StatusBadge,
  ArrowLeftIcon,
  GiftIcon,
  CartIcon,
  TRANSACTION_TYPE_LABEL,
  transactionStatusLabel,
  transactionStatusTone,
} from "@ove/shared-ui";
import { apiFetch, ApiError, type TransactionDetail } from "@/lib/api";

export default function TransactionDetailPage() {
  const params = useParams<{ transactionId: string }>();
  const router = useRouter();
  const [transaction, setTransaction] = useState<TransactionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const detail = await apiFetch<TransactionDetail>(`/api/v1/me/transactions/${params.transactionId}`);
        setTransaction(detail);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setError("取引が見つかりません");
          return;
        }
        setError("読み込みに失敗しました");
      }
    })();
  }, [params.transactionId, router]);

  if (error) {
    return (
      <main className="flex flex-col gap-4 px-4 pt-6">
        <BackHeader />
        <p className="text-sm text-sengoku-gold-soft">{error}</p>
      </main>
    );
  }

  if (!transaction) {
    return (
      <main className="flex flex-col gap-4 px-4 pt-6">
        <BackHeader />
        <p className="text-sm text-sengoku-muted">読み込み中...</p>
      </main>
    );
  }

  const title = transaction.display_name || TRANSACTION_TYPE_LABEL[transaction.transaction_type] || transaction.transaction_type;
  const signedAmount = `${transaction.direction === "CREDIT" ? "+" : "-"}${Number(transaction.amount).toLocaleString("ja-JP")}`;

  return (
    <main className="flex flex-col gap-6 px-4 pb-10 pt-6">
      <BackHeader />

      <section className="flex flex-col items-center gap-3 rounded-xl border border-sengoku-border bg-sengoku-navy px-5 py-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sengoku-gold/10 text-sengoku-gold">
          {transaction.direction === "CREDIT" ? <GiftIcon className="h-7 w-7" /> : <CartIcon className="h-7 w-7" />}
        </span>
        <p className="text-sm text-sengoku-muted">{title}</p>
        <p className={transaction.direction === "CREDIT" ? "text-3xl font-bold text-sengoku-gold" : "text-3xl font-bold text-white"}>
          {signedAmount} <span className="text-lg font-semibold text-sengoku-gold-soft">OVE</span>
        </p>
        <StatusBadge
          label={transactionStatusLabel(transaction.status, transaction.direction)}
          tone={transactionStatusTone(transaction.status)}
        />
      </section>

      <section className="divide-y divide-sengoku-border overflow-hidden rounded-xl border border-sengoku-border bg-sengoku-navy">
        <DetailRow label="取引日時" value={new Date(transaction.occurred_at).toLocaleString("ja-JP")} />
        <DetailRow label="取引ID" value={transaction.transaction_code} mono />
        <DetailRow label="取引種別" value={TRANSACTION_TYPE_LABEL[transaction.transaction_type] ?? transaction.transaction_type} />
        <DetailRow label="方向" value={transaction.direction === "CREDIT" ? "獲得" : "利用"} />
        <DetailRow label="金額" value={`${signedAmount} OVE`} />
        <DetailRow label="残高 (取引前)" value={`${Number(transaction.balance_before).toLocaleString("ja-JP")} OVE`} />
        <DetailRow label="残高 (取引後)" value={`${Number(transaction.balance_after).toLocaleString("ja-JP")} OVE`} />
        {transaction.source_service && <DetailRow label="提供元サービス" value={transaction.source_service} />}
        {transaction.source_reference_id && <DetailRow label="関連ID" value={transaction.source_reference_id} mono />}
      </section>

      {transaction.description && (
        <section className="rounded-xl border border-sengoku-border bg-sengoku-navy/50 p-4">
          <p className="text-xs font-semibold text-sengoku-muted">説明</p>
          <p className="mt-1.5 text-sm leading-relaxed text-white">{transaction.description}</p>
        </section>
      )}
    </main>
  );
}

function BackHeader() {
  return (
    <header className="flex items-center gap-3">
      <Link href="/wallet/transactions" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
        <ArrowLeftIcon className="h-5 w-5" />
      </Link>
      <h1 className="font-heading text-lg font-bold text-white">取引詳細</h1>
    </header>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-sengoku-muted">{label}</span>
      <span className={`text-sm font-semibold text-white ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
