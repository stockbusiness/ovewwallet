"use client";

import { useState } from "react";
import { apiFetch, ApiError, type WalletBalance } from "@/lib/api";

/**
 * 退会 (docs/account-closure.md)。
 *
 * **残っているORIは退会と同時に失効する。** 取り返しがつかないうえ、金額は人によって
 * 違うので、`window.confirm` の一行では足りない。押す前に自分の残高を数字で見せ、
 * そのうえでもう一段確認させる。
 */
export default function AccountClosureSection({
  balance,
  onClosed,
}: {
  balance: WalletBalance | null;
  onClosed: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = balance ? Number(balance.available_balance) : 0;
  const held = balance ? Number(balance.held_balance) : 0;

  async function close() {
    setError(null);
    setClosing(true);
    try {
      await apiFetch("/api/v1/accounts/me/close", { method: "POST" });
      // 退会に成功した時点でサーバー側のセッションは既に失効している。ここでの
      // logout はブラウザ側のCookieを消すためだけのもの (失敗しても退会は成立している)。
      await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
      onClosed();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 400
            ? "処理中の取引が残っているため、いまは退会できません。しばらく経ってからお試しください。"
            : err.message
          : "退会に失敗しました",
      );
      setClosing(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="py-2 text-xs text-sengoku-faint underline"
      >
        退会する
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-sengoku-red/40 bg-sengoku-red/5 p-4">
      <h2 className="mb-2 text-sm font-bold text-sengoku-red">退会の確認</h2>
      <ul className="mb-3 flex list-disc flex-col gap-1 pl-4 text-xs text-sengoku-muted">
        {remaining > 0 && (
          <li className="text-sengoku-text">
            残っている <strong>{remaining.toLocaleString("ja-JP")} ORI</strong> は失効します。
            元に戻すことはできません。
          </li>
        )}
        {held > 0 && (
          <li>処理中の {held.toLocaleString("ja-JP")} ORI があります。完了するまで退会できません。</li>
        )}
        <li>このアカウントには二度とログインできません。</li>
        <li>同じLINEアカウント・メールアドレスで登録し直すこともできません。</li>
        <li>取引の記録は、法令で定められた期間ののち削除されます。</li>
      </ul>

      {error && <p className="mb-3 rounded bg-red-950 p-2 text-xs text-red-300">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={close}
          disabled={closing}
          className="rounded-lg border border-sengoku-red/40 bg-sengoku-red/10 px-4 py-2 text-xs font-bold text-sengoku-red disabled:cursor-not-allowed disabled:opacity-50"
        >
          {closing ? "退会処理中..." : "退会する"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={closing}
          className="rounded-lg border border-sengoku-border px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          やめる
        </button>
      </div>
    </section>
  );
}
