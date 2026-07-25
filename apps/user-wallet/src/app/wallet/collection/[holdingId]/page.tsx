"use client";

import { ArrowLeftIcon } from "@ove/shared-ui";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CollectibleCardImage } from "@/components/CollectibleCardImage";
import { apiFetch, ApiError, type CollectibleHoldingSummary } from "@/lib/api";
import { collectibleStatusLabel } from "@/lib/collectible-status";

export default function CollectionDetailPage() {
  const params = useParams<{ holdingId: string }>();
  const router = useRouter();
  const [item, setItem] = useState<CollectibleHoldingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const detail = await apiFetch<CollectibleHoldingSummary>(`/api/v1/me/collectibles/${params.holdingId}`);
        setItem(detail);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setError("カードが見つかりません");
          return;
        }
        if (err instanceof ApiError && err.status === 503) {
          setError("現在ご利用いただけません");
          return;
        }
        setError("読み込みに失敗しました");
      }
    })();
  }, [params.holdingId, router]);

  if (error) {
    return (
      <main className="flex flex-col gap-4 px-4 pt-6">
        <BackHeader />
        <p className="text-sm text-sengoku-gold-soft">{error}</p>
      </main>
    );
  }

  if (!item) {
    return (
      <main className="flex flex-col gap-4 px-4 pt-6">
        <BackHeader />
        <p className="text-sm text-sengoku-muted">読み込み中...</p>
      </main>
    );
  }

  const label = collectibleStatusLabel(item.status);

  return (
    <main className="flex flex-col gap-6 px-4 pb-10 pt-6">
      <BackHeader />

      <section className="overflow-hidden rounded-2xl border border-sengoku-border bg-sengoku-navy">
        <div className="relative aspect-square w-full">
          <CollectibleCardImage src={item.asset.image_url} alt={item.asset.name} sizes="(max-width: 640px) 100vw, 480px" />
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <p className="text-lg font-bold text-sengoku-text">{item.asset.name}</p>
        <p className="text-xs text-sengoku-muted">#{item.serial_number}</p>
        {item.asset.rarity && (
          <span className="mt-1 inline-block w-fit rounded-full bg-sengoku-gold/15 px-3 py-1 text-xs font-semibold text-sengoku-gold">
            {item.asset.rarity}
          </span>
        )}
      </section>

      {item.asset.description && (
        <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
          <p className="text-sm leading-relaxed text-sengoku-text">{item.asset.description}</p>
        </section>
      )}

      <section className="divide-y divide-sengoku-border overflow-hidden rounded-xl border border-sengoku-border bg-sengoku-navy">
        <DetailRow label="ステータス" value={label.primary} />
        {label.secondary && <DetailRow label="Mint状態" value={label.secondary} />}
        <DetailRow label="取得日" value={new Date(item.acquired_at).toLocaleString("ja-JP")} />
        {item.asset.category && <DetailRow label="カテゴリ" value={item.asset.category} />}
        {item.asset.edition_size != null && <DetailRow label="発行数" value={`${item.asset.edition_size}枚`} />}
        {item.status === "REVOKED" && item.revoked_at && (
          <DetailRow label="取消日" value={new Date(item.revoked_at).toLocaleString("ja-JP")} />
        )}
        {item.status === "REVOKED" && item.revoke_reason && <DetailRow label="取消理由" value={item.revoke_reason} wrap />}
      </section>
    </main>
  );
}

function BackHeader() {
  return (
    <header className="flex items-center gap-3">
      <Link href="/wallet/collection" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
        <ArrowLeftIcon className="h-5 w-5" />
      </Link>
      <h1 className="font-heading text-lg font-bold text-sengoku-text">カード詳細</h1>
    </header>
  );
}

function DetailRow({ label, value, wrap }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 pt-0.5 text-xs text-sengoku-muted">{label}</span>
      <span className={`text-right text-sm font-semibold text-sengoku-text ${wrap ? "leading-relaxed" : ""}`}>{value}</span>
    </div>
  );
}
