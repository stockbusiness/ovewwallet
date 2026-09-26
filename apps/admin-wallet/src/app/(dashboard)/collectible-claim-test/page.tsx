"use client";

import { useCallback, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, type ClaimConnectionTestResult } from "@/lib/api";

/** 成功扱いにする結果。トークンが無効でも、接続と署名が通っていれば設定は正しい。 */
const SUCCESS_OUTCOMES = new Set(["ok", "token_not_found"]);

/**
 * カード受取 (Claim) の接続テスト。千ノ国マーケットの状態照会APIを実際に叩き、
 * **生のHTTPステータスと応答本文をそのまま見せる**。
 *
 * 受取ページ (`/claim/{token}`) は原因の異なる失敗をすべて503にまとめるため、
 * 利用者向けの画面からは切り分けができない。ここはその逆で、運用者が原因に
 * たどり着くことだけを目的にしている。
 */
export default function CollectibleClaimTestPage() {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<ClaimConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const run = useCallback(async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(
        await apiFetch<ClaimConnectionTestResult>("/api/v1/admin/collectible-claims/test-connection", {
          method: "POST",
          body: JSON.stringify(token.trim() ? { token: token.trim() } : {}),
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
  }, [token]);

  const succeeded = result ? SUCCESS_OUTCOMES.has(result.outcome) : false;

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">カード受取の接続テスト</h1>
      <p className="mb-4 text-xs text-sengoku-muted">
        千ノ国マーケットの受取状態照会APIを実際に呼び出し、応答をそのまま表示します。
      </p>

      <HelpPanel storageKey="collectible-claim-test" title="このページについて">
        <div>
          <p className="font-semibold text-sengoku-text">なぜ専用の画面があるのか</p>
          <p>
            利用者向けの受取ページは、<strong>設定不足・通信エラー・署名不一致・応答形式の
            不正をすべて「503」にまとめます。</strong>
            利用者に内部事情を見せないための作りですが、運用者からも原因が見えません。
            ここでは逆に、<strong>ステータスコードと先方の応答本文をそのまま出します。</strong>
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">トークンは省略できます</p>
          <p>
            空欄なら実在しないダミーを送ります。設定と署名が正しいかを見るだけならこれで十分です。
            <strong>特定の1件が受け取れない場合は、そのトークンを貼ってください。</strong>
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">受取は進みません</p>
          <p>
            状態の照会だけを行い、確定 (<code>POST .../confirm</code>) は叩きません。
            <strong>実トークンを入れても受取は消費されません。</strong>
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">404には2つの意味があります</p>
          <p>
            先方の応答に <code>CLAIM_TOKEN_INVALID</code> があればトークン側の問題で、
            接続と署名は通っています。無い場合は<strong>経路自体が無い疑い</strong>
            (先方が状態照会APIを未実装、URLの綴り違い等) として区別して表示します。
          </p>
        </div>
      </HelpPanel>

      <section className="mb-6 rounded border border-sengoku-border p-4">
        <label className="block text-xs">
          <span className="mb-1 block text-sengoku-muted">受取トークン (任意)</span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="空欄ならダミーのトークンで試します"
            className="w-full rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={testing}
          className="mt-3 rounded border border-sengoku-border px-3 py-1 text-sm disabled:opacity-50"
        >
          {testing ? "実行中..." : "接続テストを実行"}
        </button>
      </section>

      {result && (
        <section
          className={`rounded border p-4 text-sm ${
            succeeded ? "border-sengoku-green/50 bg-green-950/40" : "border-sengoku-red/50 bg-red-950/40"
          }`}
        >
          <p className="mb-3 font-semibold">
            {succeeded ? "接続できました" : "接続できませんでした"}
            <span className="ml-2 font-normal text-xs opacity-80">({result.outcome})</span>
          </p>
          <p className="mb-3 text-sengoku-text">{result.message}</p>

          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-sengoku-muted">HTTPステータス</dt>
              <dd className="break-all">{result.httpStatus ?? "(応答なし)"}</dd>
            </div>
            <div>
              <dt className="text-sengoku-muted">送信先</dt>
              <dd className="break-all">{result.requestUrl ?? "(送信していません)"}</dd>
            </div>
            <div>
              <dt className="text-sengoku-muted">連携先の応答</dt>
              <dd className="break-all">
                {result.partnerResponse ? (
                  <code>{result.partnerResponse}</code>
                ) : (
                  "(本文なし)"
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </>
  );
}
