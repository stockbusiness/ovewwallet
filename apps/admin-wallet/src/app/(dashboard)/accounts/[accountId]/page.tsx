"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, type AccountDetailItem } from "@/lib/api";

export default function AccountDetailPage() {
  const params = useParams<{ accountId: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<AccountDetailItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokeMessage, setRevokeMessage] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [confirmedBalance, setConfirmedBalance] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [resolvingReview, setResolvingReview] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<AccountDetailItem>(`/api/v1/admin/accounts/${params.accountId}`);
      setAccount(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setError("アカウントが見つかりません");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }, [params.accountId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function revokeSessions() {
    if (!window.confirm("このアカウントの全端末のログインセッションを無効化します。よろしいですか？")) return;
    setRevoking(true);
    setRevokeMessage(null);
    try {
      const res = await apiFetch<{ revokedCount: number }>(
        `/api/v1/admin/accounts/${params.accountId}/revoke-sessions`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setRevokeMessage(`${res.revokedCount}件のセッションを無効化しました。`);
      await load();
    } catch {
      setRevokeMessage("セッションの無効化に失敗しました。");
    } finally {
      setRevoking(false);
    }
  }

  async function resolveReview() {
    const balance = Number(confirmedBalance);
    if (!Number.isInteger(balance) || balance < 0 || !reviewReason) return;
    if (
      !window.confirm(
        `調査済みの残高 ${balance.toLocaleString("ja-JP")} ORI で確定します。この操作の後は再度検証できません。よろしいですか？`,
      )
    )
      return;
    setResolvingReview(true);
    setReviewMessage(null);
    try {
      await apiFetch(`/api/v1/admin/accounts/${params.accountId}/resolve-review`, {
        method: "POST",
        body: JSON.stringify({ confirmedBalance: balance, reason: reviewReason }),
      });
      setReviewMessage("検証結果を反映し、アカウントをACTIVEにしました。");
      setConfirmedBalance("");
      setReviewReason("");
      await load();
    } catch (err) {
      setReviewMessage(err instanceof ApiError ? err.message : "検証結果の反映に失敗しました。");
    } finally {
      setResolvingReview(false);
    }
  }

  if (error) {
    return <p className="text-sm text-sengoku-red">{error}</p>;
  }

  if (!account) return <p className="p-6 text-sm text-sengoku-muted">読み込み中...</p>;

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">{account.accountCode}</h1>
        <p className="mb-6 text-sm text-sengoku-muted">
          {account.displayName ?? account.primaryEmail ?? "-"} ・ 状態: {account.status} ・ 登録日:{" "}
          {new Date(account.createdAt).toLocaleDateString("ja-JP")}
        </p>

        {account.mergedIntoAccount && (
          <p className="mb-4 rounded-md bg-sengoku-gold-soft/10 p-3 text-sm text-sengoku-gold-soft">
            このアカウントは{" "}
            <Link href={`/accounts/${account.mergedIntoAccount.id}`} className="underline">
              {account.mergedIntoAccount.accountCode}
            </Link>{" "}
            に統合済みです。
          </p>
        )}

        <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-3 text-sm font-semibold">基本情報</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-sengoku-muted">メールアドレス</dt>
              <dd>{account.primaryEmail ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-sengoku-muted">電話番号</dt>
              <dd>{account.primaryPhone ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-sengoku-muted">本人確認レベル</dt>
              <dd>{account.verificationLevel}</dd>
            </div>
            <div>
              <dt className="text-xs text-sengoku-muted">ウォレット</dt>
              <dd>
                {account.wallet ? (
                  <Link href={`/wallets/${account.wallet.id}`} className="text-sengoku-gold underline">
                    {account.wallet.walletCode} (
                    {Number(account.wallet.availableBalance).toLocaleString("ja-JP")} ORI)
                  </Link>
                ) : (
                  "未作成"
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">セキュリティ</h2>
            <span className="text-xs text-sengoku-muted">アクティブセッション数: {account.activeSessionCount}</span>
          </div>
          <p className="mb-3 text-xs text-sengoku-muted">
            不正利用が疑われる場合など、このアカウントでログイン中のすべての端末を強制的にログアウトさせます。
          </p>
          <button
            onClick={revokeSessions}
            disabled={revoking || account.activeSessionCount === 0}
            className="rounded-md bg-sengoku-red px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {revoking ? "処理中..." : "全セッションを無効化"}
          </button>
          {revokeMessage && <p className="mt-2 text-xs text-sengoku-muted">{revokeMessage}</p>}
        </section>

        {account.status === "REVIEWING" && (
          <section className="mb-6 rounded-lg border border-sengoku-gold-soft/30 bg-sengoku-gold-soft/10 p-4">
            <h2 className="mb-1 text-sm font-semibold text-sengoku-gold-soft">既存ユーザー移行: 検証待ち</h2>
            <p className="mb-3 text-xs text-sengoku-gold-soft">
              既存ユーザー移行時に残高が不明だったため、推定値を入れずこのアカウントを保留しています。
              旧システム側の記録などで残高を調査したうえで、確認できた金額のみを入力してください。
            </p>
            <div className="flex flex-col gap-3">
              <label className="text-xs">
                確認済み残高 (ORI、不明な場合は調査してから入力してください)
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={confirmedBalance}
                  onChange={(e) => setConfirmedBalance(e.target.value)}
                  placeholder="例: 7000 (残高が無いことを確認した場合は 0)"
                  className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs">
                調査内容・根拠
                <input
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  placeholder="例: 旧システムの管理画面で残高7,000を確認"
                  className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
                />
              </label>
              <button
                onClick={resolveReview}
                disabled={resolvingReview || confirmedBalance === "" || !reviewReason}
                className="self-start rounded-md bg-sengoku-gold-soft px-3 py-1.5 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
              >
                {resolvingReview ? "処理中..." : "検証結果を反映してACTIVEにする"}
              </button>
            </div>
          </section>
        )}
        {/* 検証成功後は上のREVIEWINGセクション自体が消えるため、メッセージは
            status変化の影響を受けない位置に独立して表示する (成功・失敗どちらも起こりうる) */}
        {reviewMessage && (
          <p
            className={`mb-6 rounded-md p-3 text-sm ${
              account.status === "REVIEWING" ? "bg-sengoku-red/10 text-sengoku-red" : "bg-sengoku-green/10 text-sengoku-green"
            }`}
          >
            {reviewMessage}
          </p>
        )}

        <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-3 text-sm font-semibold">連携ID (ログイン手段)</h2>
          {account.identities.length === 0 && <p className="text-xs text-sengoku-faint">連携IDはありません</p>}
          <table className="w-full text-left text-xs">
            <thead className="text-sengoku-muted">
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
                <tr key={i.id} className="border-t border-sengoku-border">
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

        <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-3 text-sm font-semibold">外部サービス連携</h2>
          {account.links.length === 0 && <p className="text-xs text-sengoku-faint">外部サービス連携はありません</p>}
          <table className="w-full text-left text-xs">
            <thead className="text-sengoku-muted">
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
                <tr key={l.id} className="border-t border-sengoku-border">
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

        <section className="rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          <h2 className="mb-3 text-sm font-semibold">このアカウントに関する操作ログ</h2>
          {account.auditLogs.length === 0 && <p className="text-xs text-sengoku-faint">操作ログはありません</p>}
          <table className="w-full text-left text-xs">
            <thead className="text-sengoku-muted">
              <tr>
                <th className="pb-1">日時</th>
                <th className="pb-1">操作</th>
                <th className="pb-1">結果</th>
                <th className="pb-1">理由</th>
              </tr>
            </thead>
            <tbody>
              {account.auditLogs.map((l) => (
                <tr key={l.id} className="border-t border-sengoku-border">
                  <td className="py-1">{new Date(l.createdAt).toLocaleString("ja-JP")}</td>
                  <td className="py-1">{l.actionType}</td>
                  <td className="py-1">
                    <span className={l.result === "SUCCESS" ? "text-sengoku-green" : "text-sengoku-red"}>{l.result}</span>
                  </td>
                  <td className="py-1">{l.reason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
    </>
  );
}
