import type { MailMessage } from "./mail-sender";

/** コードの有効期限。`packages/auth/src/email-otp.ts`の`CODE_TTL_SECONDS`と揃える。 */
export const OTP_CODE_TTL_MINUTES = 10;

/**
 * ワンタイムコードのメール本文を組み立てる (純粋関数。送信も設定読み込みもしない)。
 *
 * ## プレーンテキストにしている理由
 *
 * HTMLメールは迷惑メール判定を受けやすく、OTPの通知に装飾の必要が無い。
 * 到達率を最優先する。
 *
 * ## 本文に入れないもの
 *
 * リンクを一切置かない。「メールのリンクを踏む」習慣をつけると、同じ見た目の
 * 偽メールで誘導されたときに見分けがつかなくなるため。コードを画面へ手で
 * 入力してもらう。
 */
export function buildOtpMail(params: { to: string; code: string; appName?: string }): MailMessage {
  const appName = params.appName ?? "千ノ国ウォレット";
  return {
    to: params.to,
    subject: `【${appName}】確認コード ${params.code}`,
    text: [
      `${appName}の確認コードは次のとおりです。`,
      "",
      `    ${params.code}`,
      "",
      `このコードは${OTP_CODE_TTL_MINUTES}分で使えなくなります。`,
      "ログイン画面に入力してください。",
      "",
      "お心当たりが無い場合は、このメールを破棄してください。",
      "コードを他の人に伝えないでください。",
    ].join("\n"),
  };
}
