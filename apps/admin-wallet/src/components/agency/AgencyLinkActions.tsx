"use client";

import { toStoredCode } from "@ove/shared-ui";
import { useState } from "react";
import { apiFetch, ApiError, type AgencyLinkItem } from "@/lib/api";

interface Props {
  item: AgencyLinkItem;
  /** 紐付け・解除が成功したら一覧を読み直す。 */
  onDone: () => void;
}

/**
 * 代理店の担当者とORIアカウントを手動で紐付ける操作。
 *
 * 通常この紐付けは代理店SSOログインが作るが、SSOが未接続の間や、担当者が
 * LINEログインで先にウォレットを作ってしまった場合、同期だけが届いた
 * 「未紐付け」のまま残り、その担当者宛の付与が届かなくなる。その救済に使う。
 */
export default function AgencyLinkActions({ item, onDone }: Props) {
  const [account, setAccount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/agency-links/${item.id}/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setAccount("");
      setReason("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (item.status === "REVOKED") {
    return (
      <p className="text-xs text-sengoku-faint">
        代理店システム側で解除済みのため、紐付けの変更はできません。復活させる場合は代理店システム側で操作してください。
      </p>
    );
  }

  const linked = Boolean(item.account);

  return (
    <div className="space-y-2">
      <p className="text-xs text-sengoku-muted">
        {linked
          ? "紐付け先を間違えている場合は、理由を書いて解除してください。解除前に入った付与は取り消されません。"
          : "この担当者のORIアカウントを、アカウントコード (ORI-ACC-...) で指定します。付与の宛先になるので、本人のものか必ず確認してください。"}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        {!linked && (
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-faint">ORIアカウント</span>
            <input
              className="rounded border border-sengoku-border px-2 py-1"
              placeholder="ORI-ACC-..."
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </label>
        )}
        <label className="text-xs">
          <span className="mb-1 block text-sengoku-faint">理由 (監査ログに残ります)</span>
          <input
            className="w-64 rounded border border-sengoku-border px-2 py-1"
            placeholder="例: 問い合わせ #123 の対応"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {linked ? (
          <button
            type="button"
            disabled={busy || reason.trim() === ""}
            onClick={() => run("unlink", { reason })}
            className="rounded border border-sengoku-border px-3 py-1 text-xs text-sengoku-red disabled:opacity-40"
          >
            紐付けを解除
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || account.trim() === "" || reason.trim() === ""}
            onClick={() => run("link", { account: toStoredCode(account), reason })}
            className="rounded border border-sengoku-border px-3 py-1 text-xs text-sengoku-gold disabled:opacity-40"
          >
            紐付ける
          </button>
        )}
      </div>

      {error && <p className="text-xs text-sengoku-red">{error}</p>}
    </div>
  );
}
