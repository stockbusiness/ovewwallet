import { SetMetadata } from "@nestjs/common";
import type { OveAccount } from "@ove/database";
import { CURRENT_TERMS_VERSION } from "./account-registration.service";

/**
 * 再同意を求めずに通すエンドポイントに付けるデコレータ。
 *
 * 付けてよいのは「再同意しない利用者にも残しておくべき出口」だけ
 * (同意そのもの・ログアウト・退会)。ここを広げると、規約に同意していない利用者が
 * サービスを使い続けられてしまう。
 */
export const SKIP_TERMS_CONSENT = "skipTermsConsent";
export const SkipTermsConsent = () => SetMetadata(SKIP_TERMS_CONSENT, true);

/** 副作用を持たないメソッド。閲覧は再同意前でも通す。 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * エラー応答に載せる機械可読コード。フロントエンドはこれを見て再同意画面へ誘導する
 * (英語のメッセージ文字列で判定させない)。
 */
export const TERMS_CONSENT_REQUIRED_CODE = "terms_consent_required";

/**
 * 現行バージョンへの同意が必要か。
 *
 * `termsVersion`がnullのアカウント (同意の記録を始める前に作られたもの) も対象に含める。
 * 「記録が無い」と「同意していない」を区別できない以上、同意を取り直す方が安全なため。
 */
export function isTermsConsentRequired(account: Pick<OveAccount, "termsVersion">): boolean {
  return account.termsVersion !== CURRENT_TERMS_VERSION;
}

/** 再同意前でも通してよいリクエストか。 */
export function isAllowedWithoutConsent(method: string, skipDecorated: boolean): boolean {
  return skipDecorated || READ_METHODS.has(method.toUpperCase());
}
