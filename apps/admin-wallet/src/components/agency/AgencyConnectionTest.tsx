"use client";

import { useCallback, useState } from "react";
import { apiFetch, type AgencyConnectionTestResult } from "@/lib/api";

/**
 * 代理店システムへの接続テスト。保存済みの送信先URLとAPIキーで実際に呼び出し、
 * 疎通と認証だけを確かめる。
 *
 * Feature Flagを開ける**前**に設定の正しさを確認できることが目的なので、
 * サーバー側もFlagを見ない。副作用を避けるため、実在しないIDで
 * `create_if_missing: false` を送る (相手側に何も残らない)。
 */
export default function AgencyConnectionTest({ disabled }: { disabled: boolean }) {
  const [result, setResult] = useState<AgencyConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const run = useCallback(async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(
        await apiFetch<AgencyConnectionTestResult>("/api/v1/admin/agency-setup/test-connection", {
          method: "POST",
        }),
      );
    } catch (err) {
      setResult({
        outcome: "server_error",
        message: err instanceof Error ? err.message : "接続テストの実行に失敗しました",
        requestUrl: null,
        httpStatus: null,
        partnerResponse: null,
      });
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={testing || disabled}
        className="rounded border border-sengoku-line px-3 py-1.5 text-sm hover:bg-sengoku-line/30 disabled:opacity-50"
      >
        {testing ? "接続テスト中..." : "接続テストを実行"}
      </button>
      <p className="mt-1 text-xs">
        保存済みの送信先URLとAPIキーで代理店システムを実際に呼び出し、疎通と認証だけを確かめます。
既存IDの参照だけを行うため、登録経路が使う書き込み権限 (common_users:write) までは確認できません。
        Feature Flag がOFFでも実行できます。実在しないIDで問い合わせ、作成もさせないため
        <strong>相手側には何も残りません。</strong>
      </p>

      {result ? (
        <div
          className={`mt-2 rounded border p-3 text-sm ${
            result.outcome === "ok"
              ? "border-sengoku-green/40 text-sengoku-green"
              : "border-sengoku-gold-soft/40 text-sengoku-gold-soft"
          }`}
        >
          <p className="font-semibold">{result.outcome === "ok" ? "疎通OK" : "確認が必要です"}</p>
          <p className="mt-1">{result.message}</p>
          {result.requestUrl ? (
            <p className="mt-1 break-all font-mono text-xs">{result.requestUrl}</p>
          ) : null}
          {result.partnerResponse ? (
            <p className="mt-2 break-all font-mono text-xs">
              連携先の応答: {result.partnerResponse}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
