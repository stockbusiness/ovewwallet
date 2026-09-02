"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, ApiError, type ServiceIntegrationItem } from "@/lib/api";

export default function ServiceIntegrationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<ServiceIntegrationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  // 再発行した鍵。応答の1回しか取得できないため、控えるまで表示し続ける。
  const [issued, setIssued] = useState<{ serviceCode: string; label: string; value: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<ServiceIntegrationItem[]>("/api/v1/admin/service-integrations");
      setItems(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 再発行した鍵は応答の1回しか受け取れないため、控えるまで画面に残す。
   * 明示的に閉じるまで消さない (再読み込みでは二度と取得できない)。
   */
  async function rotate(s: ServiceIntegrationItem, kind: "apiKey" | "signingSecret") {
    const label = kind === "apiKey" ? "APIキー" : "署名シークレット";
    const reason = window.prompt(
      `${s.serviceCode} の${label}を再発行します。\n\n旧${label}は即座に無効になります。` +
        `連携先へ新しい値を渡すまで、その連携先からのリクエストは失敗します。\n\n理由を入力してください (監査ログに残ります)`,
    );
    if (reason === null) return;
    if (reason.trim() === "") {
      setError("理由を入力してください");
      return;
    }
    setError(null);
    setRotating(s.id);
    try {
      const path = kind === "apiKey" ? "rotate-api-key" : "rotate-signing-secret";
      const res = await apiFetch<{ serviceCode: string; apiKey?: string; signingSecret?: string }>(
        `/api/v1/admin/service-integrations/${s.id}/${path}`,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      setIssued({
        serviceCode: res.serviceCode,
        label,
        value: kind === "apiKey" ? (res.apiKey ?? "") : (res.signingSecret ?? ""),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${label}の再発行に失敗しました`);
    } finally {
      setRotating(null);
    }
  }

  async function suspend(id: string) {
    const reason = window.prompt("緊急停止の理由を入力してください");
    if (!reason) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/service-integrations/${id}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "緊急停止に失敗しました");
    }
  }

  async function reactivate(id: string) {
    const reason = window.prompt("再開の理由を入力してください");
    if (!reason) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/admin/service-integrations/${id}/reactivate`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "再開に失敗しました");
    }
  }

  return (
    <>
        <h1 className="mb-1 text-xl font-bold">外部サービス管理</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          緊急停止すると、当該サービスのAPIキーによる外部APIリクエストは即座に拒否されます。
        </p>

        <HelpPanel storageKey="service-integrations" title="このページについて・使い方">
          <p>
            ORIウォレットへAPI経由でアクセスしている外部サービス(代理店システム等)の一覧と、
            <strong className="text-sengoku-text">APIキー・署名シークレットの再発行</strong>、緊急停止・再開を行う画面です。
            新しい外部サービスをここから追加することはできません(サービスコードの追加はエンジニアの作業が必要です)。
          </p>
          <div>
            <p className="font-semibold text-sengoku-text">いつ使うか</p>
            <p>
              ある外部サービスのAPIキーが漏えいした疑いがある、または想定外の大量アクセス・不審な動作があるなど、
              「今すぐそのサービスからのアクセスを止めたい」ときに使います。
            </p>
          </div>
          <div>
            <p className="font-semibold text-sengoku-text">操作手順</p>
            <ol className="ml-4 list-decimal">
              <li>止めたいサービスコードの行にある「緊急停止」を押す</li>
              <li>理由を入力(必須。後から誰が何のために止めたか監査ログに残ります)</li>
              <li>状態が即座に反映され、それ以降そのサービスからのAPIリクエストは全て拒否されます(遅延なし)</li>
              <li>問題が解決したら、同じ行の「再開」を押して理由を入力すると即座に復旧します</li>
            </ol>
          </div>
          <div>
            <p className="font-semibold text-sengoku-text">鍵を再発行するとき</p>
            <p>
              連携先へ渡す鍵を紛失した、漏えいの疑いがある、定期的に入れ替えたい、といった場合に使います。
              <strong className="text-sengoku-text">再発行した値が表示されるのはその場の1回だけ</strong>で、
              画面を閉じると二度と確認できません(ウォレット側はハッシュ化した値しか保持しないため)。
            </p>
            <ol className="ml-4 list-decimal">
              <li>対象の行の「APIキー再発行」または「署名シークレット再発行」を押す</li>
              <li>理由を入力(必須。監査ログに残ります)</li>
              <li>表示された値を控え、連携先の担当者へ安全な方法で渡す</li>
              <li>控えたら「控えたので閉じる」を押す</li>
            </ol>
          </div>
          <p className="text-sengoku-gold-soft">
            注意: サービスコードを間違えて停止すると、そのサービスの本番トラフィックが即座に止まります。停止前に対象のサービスコードをよく確認してください。
            鍵の再発行も同様で、<strong className="text-sengoku-text">旧い鍵は押した瞬間に無効</strong>になります。
            連携先へ新しい値を渡すまで、その連携先からのリクエストは失敗し続けます。
          </p>
        </HelpPanel>

        {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}

        {issued && (
          <section className="mb-4 rounded-lg border border-sengoku-gold bg-sengoku-navy p-4">
            <h2 className="mb-2 text-sm font-semibold text-sengoku-gold">
              {issued.serviceCode} の{issued.label}を再発行しました
            </h2>
            <p className="mb-3 text-xs text-sengoku-muted">
              この値が表示されるのは今回だけです。閉じると二度と確認できません
              (もう一度必要になった場合は、また再発行することになります)。
            </p>
            <p className="mb-3 break-all rounded-md bg-sengoku-navy-deep p-3 font-mono text-sm font-bold">
              {issued.value}
            </p>
            <button
              onClick={() => setIssued(null)}
              className="rounded-md border border-sengoku-border px-4 py-2 text-sm font-semibold"
            >
              控えたので閉じる
            </button>
          </section>
        )}

        <table className="w-full rounded-lg border border-sengoku-border bg-sengoku-navy text-left text-sm">
          <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
            <tr>
              <th className="p-3">サービスコード</th>
              <th className="p-3">状態</th>
              <th className="p-3">1リクエスト上限</th>
              <th className="p-3">1日あたり上限</th>
              <th className="p-3">最終アクセス</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-sengoku-border">
                <td className="p-3">{s.serviceCode}</td>
                <td className="p-3">
                  <span className={s.status === "ACTIVE" ? "text-sengoku-green" : "font-semibold text-sengoku-red"}>
                    {s.status}
                  </span>
                </td>
                <td className="p-3">{Number(s.perRequestAmountLimit).toLocaleString("ja-JP")} ORI</td>
                <td className="p-3">{Number(s.dailyAmountLimit).toLocaleString("ja-JP")} ORI</td>
                <td className="p-3">{s.lastAccessedAt ? new Date(s.lastAccessedAt).toLocaleString("ja-JP") : "-"}</td>
                <td className="whitespace-nowrap p-3">
                  {/* 再発行は停止中でも行える (連携先へ新しい鍵を渡してから再開したい場合があるため)。 */}
                  <button
                    onClick={() => rotate(s, "apiKey")}
                    disabled={rotating === s.id}
                    className="text-xs text-sengoku-gold underline disabled:opacity-50"
                  >
                    APIキー再発行
                  </button>
                  <button
                    onClick={() => rotate(s, "signingSecret")}
                    disabled={rotating === s.id}
                    className="ml-3 text-xs text-sengoku-gold underline disabled:opacity-50"
                  >
                    署名シークレット再発行
                  </button>
                  {s.status === "ACTIVE" ? (
                    <button onClick={() => suspend(s.id)} className="ml-3 text-xs text-sengoku-red underline">
                      緊急停止
                    </button>
                  ) : (
                    <button onClick={() => reactivate(s.id)} className="ml-3 text-xs text-sengoku-gold underline">
                      再開
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>  );
}
