/**
 * 使い捨てメールアドレスを弾いたときのエラーコード。
 *
 * 画面はこの値を見て日本語の文言を出す (`apps/user-wallet/src/app/login/page.tsx`)。
 * APIのメッセージ自体は他のエンドポイントに合わせて英語のままにしている。
 */
export const DISPOSABLE_EMAIL_ERROR_CODE = "disposable_email_domain";
