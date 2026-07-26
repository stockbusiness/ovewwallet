"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PrimaryButton, WalletLogo } from "@ove/shared-ui";
import { apiFetch, ApiError, type ClaimConfirmResult, type ClaimOverview } from "@/lib/api";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60; // 5秒間隔で最大5分

/**
 * NFTカードClaim導線実装指示書10章。表示状態:
 * Claim確認中 / ログインが必要 / 受取可能 / common_user_id解決待ち / 送付処理中 /
 * 受取完了 / 期限切れ / 返金・取消済み / エラー。
 */
type ScreenState =
  | { kind: "loading" }
  | { kind: "requires_login"; claimSessionId: string }
  | { kind: "ready"; claimSessionId: string; cardName: string | null }
  | { kind: "common_user_unresolved"; claimSessionId: string; cardName: string | null }
  | { kind: "delivery_pending"; claimSessionId: string; cardName: string | null }
  | { kind: "delivered"; cardName: string | null }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "error"; message: string };

export default function ClaimPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  const pollAttempts = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadOverview = useCallback(
    async (token: string, { replaceUrl }: { replaceUrl: boolean }) => {
      try {
        const overview = await apiFetch<ClaimOverview>(`/api/v1/collectible-claims/${token}`);
        // 生Claim Tokenがブラウザ履歴・URLバーに残らないよう、安全なClaim Session IDへ
        // 差し替える (指示書4章)。
        if (replaceUrl && overview.claim_session_id !== token) {
          router.replace(`/claim/${overview.claim_session_id}`);
        }
        applyOverview(overview);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: "error", message: "受取用のURLが正しくありません。戦国マーケットのマイページからやり直してください。" });
          return;
        }
        if (err instanceof ApiError && err.status === 410) {
          setState({ kind: "expired" });
          return;
        }
        if (err instanceof ApiError && err.status === 503) {
          setState({ kind: "error", message: "現在ご利用いただけません。しばらくしてから再度お試しください。" });
          return;
        }
        setState({ kind: "error", message: "読み込みに失敗しました。" });
      }
    },
    [router],
  );

  function applyOverview(overview: ClaimOverview) {
    if (overview.status === "EXPIRED") {
      setState({ kind: "expired" });
      return;
    }
    if (overview.status === "REVOKED") {
      setState({ kind: "revoked" });
      return;
    }
    if (overview.status === "DELIVERED") {
      setState({ kind: "delivered", cardName: overview.card_name });
      return;
    }
    if (overview.status === "DELIVERY_PENDING") {
      setState({ kind: "delivery_pending", claimSessionId: overview.claim_session_id, cardName: overview.card_name });
      return;
    }
    // PENDING
    if (overview.requires_login) {
      setState({ kind: "requires_login", claimSessionId: overview.claim_session_id });
      return;
    }
    setState({ kind: "ready", claimSessionId: overview.claim_session_id, cardName: overview.card_name });
  }

  useEffect(() => {
    void loadOverview(params.token, { replaceUrl: true });
  }, [params.token, loadOverview]);

  // 送付処理中: Page Visibilityを考慮し、タブが表示されている間だけポーリングする。
  // 最大回数(MAX_POLL_ATTEMPTS)を超えたらポーリング自体を止め、手動更新を促す。
  useEffect(() => {
    if (state.kind !== "delivery_pending") return;
    const claimSessionId = state.claimSessionId;
    pollAttempts.current = 0;

    function scheduleNext() {
      pollTimer.current = setTimeout(async () => {
        if (document.visibilityState !== "visible") {
          scheduleNext();
          return;
        }
        pollAttempts.current += 1;
        if (pollAttempts.current > MAX_POLL_ATTEMPTS) {
          setState({
            kind: "error",
            message: "送付の確認に時間がかかっています。画面を更新して状態をご確認ください。",
          });
          return;
        }
        await loadOverview(claimSessionId, { replaceUrl: false });
        scheduleNext();
      }, POLL_INTERVAL_MS);
    }
    scheduleNext();

    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [state.kind === "delivery_pending" ? state.claimSessionId : null]);

  async function confirmClaim(claimSessionId: string) {
    setConfirming(true);
    try {
      const result = await apiFetch<ClaimConfirmResult & { error?: string }>(`/api/v1/collectible-claims/${claimSessionId}/confirm`, {
        method: "POST",
      });
      if (result.action === "common_user_unresolved") {
        setState({ kind: "common_user_unresolved", claimSessionId, cardName: null });
        return;
      }
      setState({ kind: "delivery_pending", claimSessionId, cardName: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/login?return_to=${encodeURIComponent(`/claim/${claimSessionId}`)}`);
        return;
      }
      if (err instanceof ApiError && err.status === 410) {
        setState({ kind: "expired" });
        return;
      }
      if (err instanceof ApiError && (err.status === 409 || err.status === 404 || err.status === 503)) {
        setState({ kind: "error", message: "受取処理に失敗しました。しばらくしてから再度お試しください。" });
        return;
      }
      setState({ kind: "error", message: "受取処理に失敗しました。" });
    } finally {
      setConfirming(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-sengoku-bg px-6 pb-10 pt-16 text-center">
      <WalletLogo className="h-16 w-16 text-sengoku-gold" />

      {state.kind === "loading" && <p className="text-sm text-sengoku-muted">Claim確認中...</p>}

      {state.kind === "requires_login" && (
        <>
          <p className="text-sm leading-relaxed text-sengoku-text">
            購入したNFTカードを受け取るには、千ノ国ウォレットへのログインが必要です。
          </p>
          <PrimaryButton onClick={() => router.push(`/login?return_to=${encodeURIComponent(`/claim/${state.claimSessionId}`)}`)}>
            ログインする
          </PrimaryButton>
        </>
      )}

      {state.kind === "ready" && (
        <>
          {state.cardName && <p className="text-base font-bold text-sengoku-text">{state.cardName}</p>}
          <p className="text-sm text-sengoku-muted">NFTカードを千ノ国ウォレットで受け取ります。</p>
          <PrimaryButton onClick={() => void confirmClaim(state.claimSessionId)} disabled={confirming}>
            {confirming ? "受け取り中..." : "受け取る"}
          </PrimaryButton>
        </>
      )}

      {state.kind === "common_user_unresolved" && (
        <p className="text-sm leading-relaxed text-sengoku-muted">アカウント情報を確認しています。しばらくしてから再度お試しください。</p>
      )}

      {state.kind === "delivery_pending" && (
        <>
          {state.cardName && <p className="text-base font-bold text-sengoku-text">{state.cardName}</p>}
          <p className="text-sm text-sengoku-muted">NFTカードをウォレットへ送付しています。</p>
        </>
      )}

      {state.kind === "delivered" && (
        <>
          {state.cardName && <p className="text-base font-bold text-sengoku-text">{state.cardName}</p>}
          <p className="text-sm text-sengoku-muted">NFTカードを受け取りました。</p>
          <Link href="/wallet/collection">
            <PrimaryButton>コレクションを見る</PrimaryButton>
          </Link>
        </>
      )}

      {state.kind === "expired" && (
        <p className="text-sm leading-relaxed text-sengoku-muted">
          受取期限が切れています。戦国マーケットのマイページから再発行してください。
        </p>
      )}

      {state.kind === "revoked" && (
        <p className="text-sm leading-relaxed text-sengoku-muted">この受取は返金・取消済みのため利用できません。</p>
      )}

      {state.kind === "error" && <p className="text-sm leading-relaxed text-sengoku-gold-soft">{state.message}</p>}
    </main>
  );
}
