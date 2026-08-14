"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PrimaryButton, WalletLogo } from "@ove/shared-ui";
import { apiFetch, ApiError, type ClaimConfirmResult, type ClaimOverview } from "@/lib/api";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60; // 5秒間隔で最大5分

/**
 * NFTカードClaim導線実装指示書10章 + 千ノ国NFTマーケット契約v2指示書12・13章。表示状態:
 * Claim確認中 / ログインが必要 / 受取可能 / Wallet側common_user_id解決待ち /
 * Market側購入者ID解決待ち / 送付処理中 / 受取完了 / アカウント不一致 / 期限切れ /
 * 返金・取消済み / ネットワークエラー / エラー。
 */
type ScreenState =
  | { kind: "loading" }
  | { kind: "requires_login"; claimSessionId: string }
  | { kind: "ready"; claimSessionId: string; cardName: string | null }
  | { kind: "common_user_unresolved"; claimSessionId: string; cardName: string | null }
  /** 契約v2指示書13章。Wallet側とは別の、Market側の購入者ID未解決。 */
  | { kind: "market_common_user_pending"; claimSessionId: string; cardName: string | null }
  | { kind: "delivery_pending"; claimSessionId: string; cardName: string | null }
  | { kind: "delivered"; cardName: string | null }
  /** 契約v2指示書12章。COMMON_USER_MISMATCH専用状態。 */
  | { kind: "account_mismatch" }
  | { kind: "expired" }
  /** 契約v2指示書26〜28章。Market側entitlementの期限切れ(`expired`)とは別に、
   * Wallet側Claim Session(24時間)の期限切れを専用状態・専用文言で示す。 */
  | { kind: "claim_session_expired" }
  | { kind: "revoked" }
  | { kind: "network_error" }
  | { kind: "error"; message: string };

/**
 * confirmClaim()の失敗を画面状態へ分類する。`confirmClaim`自体の複雑度を抑えるため
 * コンポーネント外の純粋関数として分離 (401は呼び出し元でログイン画面へ遷移するため
 * ここには含めない)。
 */
function mapConfirmErrorToState(err: ApiError): ScreenState {
  // 契約v2指示書26〜28章。同じ410でもWallet側Session期限切れとMarket側expiredは
  // 別の状態・別の文言で案内する。
  if (err.code === "claim_session_expired") return { kind: "claim_session_expired" };
  if (err.status === 410) return { kind: "expired" };
  // 契約v2指示書12章。アカウント不一致は専用状態・専用文言で「次に取るべき行動」を示す。
  if (err.code === "common_user_mismatch") return { kind: "account_mismatch" };
  if (err.code === "revoked") return { kind: "revoked" };
  if (err.status === 503) return { kind: "network_error" };
  if (err.code === "processing") return { kind: "error", message: "処理中です。しばらくしてから再度お試しください。" };
  if (err.status === 409 || err.status === 404) {
    return { kind: "error", message: "受取処理に失敗しました。しばらくしてから再度お試しください。" };
  }
  return { kind: "error", message: "受取処理に失敗しました。" };
}

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
        // 契約v2指示書26〜28章。同じ410でもWallet側Session期限切れとMarket側expiredは
        // 別の状態・別の文言で案内する。
        if (err instanceof ApiError && err.code === "claim_session_expired") {
          setState({ kind: "claim_session_expired" });
          return;
        }
        if (err instanceof ApiError && err.status === 410) {
          setState({ kind: "expired" });
          return;
        }
        if (err instanceof ApiError && err.status === 503) {
          setState({ kind: "network_error" });
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
      if (result.action === "market_common_user_pending") {
        setState({ kind: "market_common_user_pending", claimSessionId, cardName: null });
        return;
      }
      setState({ kind: "delivery_pending", claimSessionId, cardName: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/login?return_to=${encodeURIComponent(`/claim/${claimSessionId}`)}`);
        return;
      }
      setState(err instanceof ApiError ? mapConfirmErrorToState(err) : { kind: "error", message: "受取処理に失敗しました。" });
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

      {state.kind === "market_common_user_pending" && (
        <p className="text-sm leading-relaxed text-sengoku-muted">購入情報を確認しています。しばらくしてから再度お試しください。</p>
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

      {state.kind === "claim_session_expired" && (
        <p className="text-sm leading-relaxed text-sengoku-muted">
          受取用セッションの有効期限が切れています。千ノ国NFTマーケットから再度受取手続きを行ってください。
        </p>
      )}

      {state.kind === "revoked" && (
        <p className="text-sm leading-relaxed text-sengoku-muted">この受取は返金・取消済みのため利用できません。</p>
      )}

      {state.kind === "account_mismatch" && (
        <p className="text-sm leading-relaxed text-sengoku-gold-soft">この商品を購入したアカウントでログインしてください。</p>
      )}

      {state.kind === "network_error" && (
        <p className="text-sm leading-relaxed text-sengoku-muted">現在ご利用いただけません。しばらくしてから再度お試しください。</p>
      )}

      {state.kind === "error" && <p className="text-sm leading-relaxed text-sengoku-gold-soft">{state.message}</p>}
    </main>
  );
}
