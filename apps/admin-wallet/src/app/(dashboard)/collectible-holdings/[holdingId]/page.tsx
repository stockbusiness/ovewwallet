"use client";

import { toDisplayCode } from "@ove/shared-ui";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, type CollectibleHoldingItem } from "@/lib/api";
import {
  resolveRevokeReasonDisplay,
  type RevokeReasonDisplay,
} from "@/lib/collectible-revoke-reason";

/** NFTコレクション実装指示書14章。保有詳細+管理画面からの手動取消。 */
export default function CollectibleHoldingDetailPage() {
  const params = useParams<{ holdingId: string }>();
  const router = useRouter();
  const [holding, setHolding] = useState<CollectibleHoldingItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<CollectibleHoldingItem>(
        `/api/v1/admin/collectible/holdings/${params.holdingId}`,
      );
      setHolding(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setError("保有が見つかりません");
        return;
      }
      setError(
        err instanceof ApiError ? err.message : "読み込みに失敗しました",
      );
    }
  }, [params.holdingId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke() {
    if (!reason.trim()) return;
    if (!window.confirm("このカードの利用権を取消します。よろしいですか？"))
      return;
    setRevoking(true);
    setMessage(null);
    setError(null);
    try {
      await apiFetch(
        `/api/v1/admin/collectible/holdings/${params.holdingId}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        },
      );
      setMessage("取消しました");
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "取消に失敗しました");
    } finally {
      setRevoking(false);
    }
  }

  if (error) {
    return <p className="text-sm text-sengoku-red">{error}</p>;
  }

  if (!holding) {
    return <p className="text-sm text-sengoku-muted">読み込み中...</p>;
  }

  const revokeReasonDisplay = resolveRevokeReasonDisplay(
    holding.revokeReasonCode,
  );

  return (
    <>
      <h1 className="mb-4 text-xl font-bold">カード保有詳細</h1>

      <section className="mb-6 flex gap-4 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md bg-sengoku-bg">
          <Image
            src={holding.asset.imageUrl}
            alt={holding.asset.name}
            fill
            sizes="96px"
            className="object-cover"
          />
        </div>
        <div className="text-sm">
          <p className="font-semibold">{holding.asset.name}</p>
          <p className="text-xs text-sengoku-muted">
            asset_code: {holding.asset.assetCode}
          </p>
          {holding.asset.rarity && (
            <p className="text-xs text-sengoku-muted">
              レアリティ: {holding.asset.rarity}
            </p>
          )}
        </div>
      </section>

      <table className="mb-6 w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
        <tbody>
          <Row label="保有ID" value={holding.id} mono />
          <Row
            label="保有アカウント"
            value={toDisplayCode(holding.account?.accountCode) ?? holding.oveAccountId}
            mono
          />
          <Row
            label="common_user_id"
            value={holding.account?.commonUserId ?? "-"}
            mono
          />
          <Row label="entitlement_id" value={holding.entitlementId} mono />
          <Row label="order_id" value={holding.orderId ?? "-"} mono />
          <Row label="order_item_id" value={holding.orderItemId ?? "-"} mono />
          <Row label="送信元" value={holding.sourceSystemKey} />
          <Row
            label="取得日"
            value={new Date(holding.acquiredAt).toLocaleString("ja-JP")}
          />
          <Row label="状態" value={holding.status} />
          <RevokeTrackingRows
            holding={holding}
            revokeReasonDisplay={revokeReasonDisplay}
          />
          {holding.network && (
            <Row label="ネットワーク" value={holding.network} />
          )}
          {holding.tokenId && (
            <Row label="token_id" value={holding.tokenId} mono />
          )}
          {holding.contractAddress && (
            <Row
              label="コントラクトアドレス"
              value={holding.contractAddress}
              mono
            />
          )}
        </tbody>
      </table>

      {message && <p className="mb-4 text-sm text-sengoku-green">{message}</p>}

      {holding.status !== "REVOKED" && (
        <section className="rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-2 text-sm font-semibold">手動取消</h2>
          <div className="flex items-end gap-3">
            <label className="flex-1 text-xs">
              取消理由
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={revoke}
              disabled={revoking || !reason.trim()}
              className="rounded-md bg-sengoku-red px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {revoking ? "処理中..." : "取消する"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

/** PR-W3-a: revoked時のトラッキング情報 (取消理由・取消元イベント) をまとめて描画する。 */
function RevokeTrackingRows({
  holding,
  revokeReasonDisplay,
}: {
  holding: CollectibleHoldingItem;
  revokeReasonDisplay: RevokeReasonDisplay | null;
}) {
  return (
    <>
      {holding.revokedAt && (
        <Row
          label="取消日"
          value={new Date(holding.revokedAt).toLocaleString("ja-JP")}
        />
      )}
      {revokeReasonDisplay && (
        <Row label="取消理由" value={revokeReasonDisplay.primary} />
      )}
      {revokeReasonDisplay && (
        <Row label="取消理由の説明" value={revokeReasonDisplay.description} />
      )}
      {holding.revokedBySourceSystemKey && (
        <Row
          label="取消元 source_system_key"
          value={holding.revokedBySourceSystemKey}
          mono
        />
      )}
      {holding.revokedByEventId && (
        <Row label="取消元 event_id" value={holding.revokedByEventId} mono />
      )}
      {holding.revokedCorrelationId && (
        <Row
          label="取消元 correlation_id"
          value={holding.revokedCorrelationId}
          mono
        />
      )}
      {holding.revokedOccurredAt && (
        <Row
          label="Market側発生日時 (occurred_at)"
          value={new Date(holding.revokedOccurredAt).toLocaleString("ja-JP")}
        />
      )}
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <tr className="border-t border-sengoku-border">
      <td className="w-48 p-3 text-xs text-sengoku-muted">{label}</td>
      <td className={`p-3 ${mono ? "font-mono text-xs" : ""}`}>{value}</td>
    </tr>
  );
}
