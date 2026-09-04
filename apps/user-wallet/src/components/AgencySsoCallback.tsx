"use client";

import { PrimaryButton, WalletLogo } from "@ove/shared-ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TermsCheckbox } from "@/components/TermsCheckbox";
import { apiFetch, ApiError } from "@/lib/api";

/**
 * 代理店システム(sengoku-ai.com)のSSO起動URL。ここへ遷移すると新しいJWTが発行され、
 * この画面へ`?token=`付きで戻ってくる。既定値をコードに持つのは`AuthService`が
 * `SENGOKU_AI_SSO_ISSUER`等の既定値を持つのと同じ方針 (連携先は1社に固定のため)。
 */
const LAUNCH_URL =
  process.env.NEXT_PUBLIC_AGENCY_SSO_LAUNCH_URL ??
  "https://sengoku-ai.com/agent/sso_launch.php?client=orly-wallet";

/**
 * 規約同意済みの印。**トークンそのものは保存しない** (AGENTS.md禁止事項9)。
 * 保存するのは「同意した」という真偽値だけで、これはログインの資格情報ではない。
 *
 * これが必要な理由: 代理店SSOのJWTは発行から60秒で失効する (`packages/auth/src/agency-sso.ts`)。
 * 初回ログインの利用者に規約を読ませてからAPIへ送ると、その間にトークンが切れて必ず
 * 失敗する。そこで同意を受け取ったらSSO起動URLへ戻してJWTを取り直し、戻ってきた
 * 時点で同意済みとして即座に送信する。sessionStorageなのでタブを閉じれば消える。
 */
const CONSENT_KEY = "ove-agency-sso-terms-accepted";

function readStoredConsent(): boolean {
  try {
    return window.sessionStorage.getItem(CONSENT_KEY) === "true";
  } catch {
    // プライベートブラウジング等でsessionStorageが使えない場合。同意画面を
    // もう一度出すだけなので、ログインの妨げにはならない。
    return false;
  }
}

function writeStoredConsent(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(CONSENT_KEY, "true");
    else window.sessionStorage.removeItem(CONSENT_KEY);
  } catch {
    // 保存できなくても同意画面が再表示されるだけ。
  }
}

type Phase = "verifying" | "terms" | "error";

/** APIの失敗を、利用者が次に何をすればよいか分かる日本語にする。 */
function messageForError(err: unknown): string {
  if (!(err instanceof ApiError)) return "ログインに失敗しました。もう一度お試しください。";
  switch (err.status) {
    case 404:
      // assertLoginMethodEnabled("agency") — ENABLE_AGENCY_LOGINが未設定/false。
      return "代理店ログインは現在受け付けていません。管理者へお問い合わせください。";
    case 401:
      // JWT検証失敗。60秒の有効期限切れ、署名不正、aud不一致、jti再利用のいずれか。
      return "ログインの有効期限が切れたか、トークンが無効です。代理店システムからもう一度ログインしてください。";
    case 403:
      return "このアカウントは退会済みのためログインできません。";
    default:
      return err.message || "ログインに失敗しました。もう一度お試しください。";
  }
}

/**
 * 代理店システムのSSO受信画面 (`/sso/agency?token={JWT}`)。
 *
 * 連携先の`sso_launch.php`がRS256署名済みJWTを発行し、クエリ文字列`token`で
 * ここへリダイレクトしてくる。この画面はそのJWTをAPIへ渡すだけで、検証は
 * すべてサーバー側 (`POST /api/v1/auth/sso/agency`) が行う。
 *
 * セッションCookieはAPIドメインが発行するため、ここではCookieに触れない
 * (`apiFetch`は相対パスで呼び、next.config.mjsのrewritesが同一オリジンに見せる)。
 */
export function AgencySsoCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [error, setError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // React StrictModeではuseEffectが2回走る。同じJWTを2回送るとjtiの再利用として
  // 2回目が必ず401になるため、送信は1度だけに絞る。
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const token = searchParams.get("token");
    // URLに載った生のJWTを履歴とRefererから消す (開発ガイドライン5.4章、
    // /invite が Referrer-Policy: no-referrer を付けているのと同じ理由)。
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      setPhase("error");
      setError("ログイン情報が見つかりません。代理店システムからログインしてください。");
      return;
    }

    void submit(token, readStoredConsent());
    // 依存配列は空のまま。searchParamsは初回の値だけを使い、URLを書き換えた後に
    // 再実行させない (再実行すると同じJWTを二度送ることになる)。
  }, []);

  async function submit(token: string, accepted: boolean) {
    setPhase("verifying");
    setError(null);
    try {
      await apiFetch("/api/v1/auth/sso/agency", {
        method: "POST",
        body: JSON.stringify(accepted ? { token, termsAccepted: true } : { token }),
      });
      writeStoredConsent(false);
      router.replace("/wallet");
    } catch (err) {
      // 400は「新規アカウント作成には規約同意が必要」だけ
      // (`AccountRegistrationService.findOrCreateByIdentity`)。tokenは送信前に
      // 存在を確認しているので、入力検証で400になる経路はない。
      if (err instanceof ApiError && err.status === 400) {
        setPhase("terms");
        return;
      }
      setPhase("error");
      setError(messageForError(err));
    }
  }

  function acceptTermsAndRelogin() {
    // 同意を保存したうえでJWTを取り直しに行く。手元のトークンは既に60秒の期限を
    // 使い切っている可能性が高く、そのまま再送しても401になるため。
    setSubmitting(true);
    writeStoredConsent(true);
    window.location.href = LAUNCH_URL;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-sengoku-bg px-6 py-10">
      <WalletLogo className="h-16 w-16 text-sengoku-gold" />

      {phase === "verifying" && (
        <p className="text-sm text-sengoku-muted" role="status">
          代理店システムからのログインを確認しています...
        </p>
      )}

      {phase === "terms" && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <div className="text-center">
            <h1 className="text-lg font-bold text-sengoku-text">はじめてのご利用です</h1>
            <p className="mt-1 text-sm text-sengoku-muted">
              アカウントを作成するには利用規約への同意が必要です。
            </p>
          </div>
          <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
          <PrimaryButton onClick={acceptTermsAndRelogin} disabled={!termsAccepted || submitting}>
            {submitting ? "代理店システムへ戻っています..." : "同意してログインを続ける"}
          </PrimaryButton>
          <p className="text-center text-xs text-sengoku-muted">
            安全のため代理店システムでログインをやり直します。
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <p className="text-center text-sm text-sengoku-text" role="alert">
            {error}
          </p>
          <PrimaryButton onClick={() => { window.location.href = LAUNCH_URL; }}>
            代理店システムからやり直す
          </PrimaryButton>
        </div>
      )}
    </main>
  );
}
