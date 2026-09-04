"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AgencySetupStep from "@/components/agency/AgencySetupStep";
import AgencyConnectionTest from "@/components/agency/AgencyConnectionTest";
import { apiFetch, ApiError, type AgencySetupStatus, type AgencySetupFlagKey } from "@/lib/api";

const FLAG_PURPOSE: Record<AgencySetupFlagKey, string> = {
  ENABLE_PLATFORM_USER_ID: "共通ID(common_user_id)の解決。紹介確定の前提",
  ENABLE_WALLET_REFERRAL_TOKEN: "紹介URLの受け付け",
  ENABLE_AGENCY_REFERRAL_SYNC: "代理店システムへの登録完了通知",
  ENABLE_AGENCY_POINT_AWARD_INBOX: "代理店からのORI付与イベントの受信",
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("ja-JP") : "-";
}

export default function AgencySetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<AgencySetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await apiFetch<AgencySetupStatus>("/api/v1/admin/agency-setup"));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);


  if (error) return <p className="text-sengoku-red">{error}</p>;
  if (!status) return <p className="text-sengoku-faint">読み込み中...</p>;

  const flagsAllOn = Object.values(status.flags).every(Boolean);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">代理店連携セットアップ</h1>
        <p className="mt-1 text-sm text-sengoku-faint">
          代理店システム (sengoku-ai.com) との連携を有効にするまでの手順と、現在の状態です。
          上から順に進めてください。この画面は状態を表示するだけで、設定の変更は各リンク先で行います。
        </p>
      </header>

      <ol className="space-y-3">
        <AgencySetupStep
          number={1}
          title="system_key を代理店システム側の登録値に合わせる"
          state={status.systemKey.matches ? "done" : "todo"}
          href="/common-user-hub-config"
        >
          <p>
            現在: <span className="font-mono">{status.systemKey.current}</span> / 期待値:{" "}
            <span className="font-mono">{status.systemKey.expected}</span>
          </p>
          <p className="mt-1">
            登録完了通知の <span className="font-mono">system_key</span> /{" "}
            <span className="font-mono">source_system_key</span> としてこの値がそのまま送られます。
            代理店システム側の登録値と一致していないと通知が弾かれます。
            <strong className="text-sengoku-gold-soft">先に代理店システム側の登録値をご確認ください。</strong>
          </p>
        </AgencySetupStep>

        <AgencySetupStep
          number={2}
          title="共通顧客HUB の APIキーを設定する (代理店システムが発行)"
          state={status.hubApiKey.set ? "done" : "todo"}
          href="/common-user-hub-config"
        >
          <p>
            {status.hubApiKey.set
              ? `設定済み (末尾 ${status.hubApiKey.preview ?? "?"}、最終更新 ${formatDateTime(status.hubApiKey.updatedAt)})`
              : "未設定"}
          </p>
          <p className="mt-1">
            新規登録時に共通ID (common_user_id) を問い合わせるための鍵です。
            <strong>ORI側では発行できません。</strong>代理店システムの担当者から受け取ってください。
          </p>

          <AgencyConnectionTest disabled={!status.hubApiKey.set} />
        </AgencySetupStep>

        <AgencySetupStep
          number={3}
          title="受信用APIキーを発行して代理店システムへ渡す (ORI側が発行)"
          state={status.inboundApiKey.lastAccessedAt ? "done" : "todo"}
          href="/service-integrations"
          linkLabel="外部サービス管理を開く (AGENCY_SYSTEM の「APIキー再発行」)"
        >
          <p>
            発行状況: {status.inboundApiKey.issued ? `作成済み (${formatDateTime(status.inboundApiKey.issuedAt)})` : "未作成"}
            {status.inboundApiKey.status ? ` / 状態: ${status.inboundApiKey.status}` : ""}
          </p>
          <p className="mt-1">
            代理店システムからの接続:{" "}
            {status.inboundApiKey.lastAccessedAt ? (
              <span className="text-sengoku-green">
                あり ({formatDateTime(status.inboundApiKey.lastAccessedAt)})
              </span>
            ) : (
              <span className="text-sengoku-gold-soft">まだありません</span>
            )}
          </p>
          <p className="mt-1">
            鍵の生値は保存していないため、渡し直すには再発行が必要です。
            <strong className="text-sengoku-gold-soft">再発行した瞬間に旧キーは無効になります。</strong>
            表示は1度きりなので、控えてから閉じてください。受け渡しは暗号化メッセンジャー等の安全な手段で。
          </p>
        </AgencySetupStep>

        <AgencySetupStep
          number={4}
          title="Feature Flag を有効にする"
          state={flagsAllOn ? "done" : "blocked"}
          href="/outbox"
          linkLabel="外部連携キューでフラグ一覧を見る"
        >
          <ul className="space-y-1">
            {(Object.keys(FLAG_PURPOSE) as AgencySetupFlagKey[]).map((key) => (
              <li key={key}>
                <span className={status.flags[key] ? "text-sengoku-green" : "text-sengoku-gold-soft"}>
                  {status.flags[key] ? "ON " : "OFF"}
                </span>{" "}
                <span className="font-mono text-xs">{key}</span> — {FLAG_PURPOSE[key]}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            フラグは環境変数のため、管理画面からは変更できません。
            <strong>エンジニアへ依頼してください</strong> (`.github/workflows/deploy.yml` で管理しています)。
          </p>
        </AgencySetupStep>

        <AgencySetupStep
          number={5}
          title="接続テストと実績の確認"
          state="info"
          href="/wallet-referrals"
          linkLabel="紹介トークン受け入れを見る"
        >
          <p>
            紹介トークン:{" "}
            {Object.keys(status.referrals).length === 0
              ? "まだ1件もありません"
              : Object.entries(status.referrals)
                  .map(([key, count]) => `${key} ${count}件`)
                  .join(" / ")}
          </p>
          <p className="mt-1">
            代理店の紐付け:{" "}
            {Object.keys(status.agencyLinks).length === 0
              ? "まだ1件もありません"
              : Object.entries(status.agencyLinks)
                  .map(([key, count]) => `${key} ${count}件`)
                  .join(" / ")}
          </p>
          <p className="mt-1">
            <strong className="text-sengoku-gold-soft">PENDING のまま残っている紐付けには付与できません</strong>
            (そのイベントは404になります)。代理店SSOを通っていない担当者は、代理店連携状態の画面から手動で紐付けてください。
          </p>
        </AgencySetupStep>
      </ol>
    </div>
  );
}
