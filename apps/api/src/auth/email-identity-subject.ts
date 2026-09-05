import { canonicalizeEmailForIdentity } from "./email-address-policy";

/** 既に登録済みかどうかを引く関数。DBを触らずに検証できるよう引数で受け取る。 */
export type IdentityLookup = (provider: string, providerSubject: string) => Promise<boolean>;

/**
 * メールログインで使う `provider_subject` を決める。
 *
 * 原則は正規形 (`canonicalizeEmailForIdentity`)。`tanaka+1@gmail.com` と
 * `tanaka+2@gmail.com` は同じ受信箱なので、別々のアカウントを作らせない。
 *
 * ただし**正規化を入れる前に入力どおりのアドレスで登録済みの人**は、そのまま
 * 既存のアカウントへ入れる。ここで正規形に寄せてしまうと、その人は残高ごと
 * 別のアカウントへ移ったように見える (実際には新しい空のアカウントが作られる)。
 */
export async function resolveEmailProviderSubject(
  email: string,
  hasIdentity: IdentityLookup,
): Promise<string> {
  const raw = email.trim().toLowerCase();
  const canonical = canonicalizeEmailForIdentity(email);
  if (raw === canonical) return canonical;

  return (await hasIdentity("EMAIL", raw)) ? raw : canonical;
}
