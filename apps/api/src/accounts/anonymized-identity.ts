import { hmacSign } from "@ove/auth";

/**
 * 匿名化した`provider_subject`の目印。ログイン時に「これは匿名化済みの行」と
 * 判別するためと、生の値と取り違えないために付ける。
 */
export const ANONYMIZED_SUBJECT_PREFIX = "anon:";

/** 鍵の用途を分けるための固定文字列 (同じ鍵を他の用途にも使うときに衝突させない)。 */
const HASH_DOMAIN = "anonymized-identity:";

/**
 * 匿名化用のハッシュ鍵。
 *
 * `ENCRYPTION_KEY`とは**別の鍵**にしている。`ENCRYPTION_KEY`はローテーション手順が
 * 用意されている (`docs/deployment.md`) が、ハッシュは復号できないため鍵を変えると
 * 過去に匿名化した行と照合できなくなり、**退会済みの利用者が再登録できてしまう**。
 * ローテーションしない前提の鍵を分けて持つ。
 *
 * 未設定なら`null`。呼び出し側は匿名化を実行せずに中止する (fail-closed。鍵が無い
 * まま実行すると、二度と照合できないハッシュを書き込んでしまうため)。
 */
export function anonymizationHashKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.ANONYMIZATION_HASH_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * `provider_subject`を復元できない形に変換する。
 *
 * 単純に消さないのは、この値が**退会済みアカウントの再登録を拒否するためのキー**
 * だから (`docs/account-closure.md`)。消すと同一人物の再登録を検出できなくなる。
 * ハッシュにすれば、生のLINEユーザーID等は残さないまま照合だけ続けられる。
 */
export function anonymizeSubject(subject: string, key: string): string {
  return `${ANONYMIZED_SUBJECT_PREFIX}${hmacSign(key, HASH_DOMAIN + subject)}`;
}

/** 既に匿名化済みの値か。 */
export function isAnonymizedSubject(subject: string): boolean {
  return subject.startsWith(ANONYMIZED_SUBJECT_PREFIX);
}
