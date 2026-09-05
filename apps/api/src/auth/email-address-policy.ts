import { DISPOSABLE_EMAIL_DOMAINS_RAW } from "./disposable-email-domains.generated";

/**
 * 使い捨てメールアドレスの判定と、別名アドレスの正規化。
 *
 * 判定を外部APIに投げていないのは、利用者のメールアドレスを外部サービスへ
 * 送ることになるため (AGENTS.md: 個人情報を無関係な外部へ渡さない)。
 */

/** 既定の使い捨てドメイン集合。モジュール読み込み時に一度だけ展開する。 */
export const BUILT_IN_DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set(
  DISPOSABLE_EMAIL_DOMAINS_RAW.split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0),
);

/**
 * ドット・プラスの別名を潰してよいドメイン。
 *
 * **提供元が「同じ受信箱に届く」と明言しているものだけを入れる。** 仕様上、`+`より前が
 * 同じでも別の受信箱でありうるため、無条件に潰すと *他人のアカウントに入れてしまう*。
 * 迷ったら入れない (別名で二重登録される方が、他人のアカウントを開けるより軽い)。
 */
const PLUS_ALIAS_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.jp",
  "hotmail.com",
  "hotmail.co.jp",
  "live.com",
  "live.jp",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "fastmail.com",
]);

/** ドットも無視されるドメイン (Gmailのみ。`a.b@gmail.com` と `ab@gmail.com` は同一)。 */
const DOT_INSENSITIVE_DOMAINS: ReadonlySet<string> = new Set(["gmail.com", "googlemail.com"]);

/** googlemail.com は gmail.com の別名なので寄せる。 */
const DOMAIN_ALIASES: ReadonlyMap<string, string> = new Map([["googlemail.com", "gmail.com"]]);

/** `local@domain` に分解する。`@` が1つでない等、分解できなければ `null`。 */
function splitAddress(email: string): { local: string; domain: string } | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (local.length === 0 || domain.length === 0 || domain.includes("@")) return null;
  return { local, domain };
}

/** メールアドレスのドメイン部を小文字で返す。取り出せなければ空文字。 */
export function emailDomain(email: string): string {
  return splitAddress(email)?.domain ?? "";
}

/**
 * 使い捨てドメインかどうか。
 *
 * 完全一致に加えて**上位ドメインでも一致させる**。使い捨てメールは
 * `xxx.mailinator.com` のようにサブドメインを無限に生やす作りのものが多く、
 * 完全一致だけでは素通りするため。
 *
 * ただし `com` のような1ラベルでは判定しない。誤って登録すると全ドメインが
 * 塞がるため (管理画面から `com` を追加できてしまうことへの保険)。
 */
export function isDisposableEmailDomain(domain: string, blocked: ReadonlySet<string>): boolean {
  const normalized = domain.trim().toLowerCase();
  if (normalized.length === 0) return false;

  const labels = normalized.split(".");
  for (let i = 0; i + 2 <= labels.length; i += 1) {
    const suffix = labels.slice(i).join(".");
    if (blocked.has(suffix)) return true;
  }
  return false;
}

/**
 * 同じ受信箱を指す別名アドレスを1つに寄せる (アカウントの同一性判定用)。
 *
 * `tanaka+1@gmail.com` と `tanaka+2@gmail.com` は同じ受信箱なので、別々の
 * アカウントを作らせない。**表示や送信には使わない** (利用者が入力した
 * アドレス宛に届けるため)。
 *
 * 別名を潰してよいと分かっているドメイン以外は、小文字化だけして返す。
 */
export function canonicalizeEmailForIdentity(email: string): string {
  const parts = splitAddress(email);
  if (!parts) return email.trim().toLowerCase();

  const domain = DOMAIN_ALIASES.get(parts.domain) ?? parts.domain;
  let local = parts.local;

  if (PLUS_ALIAS_DOMAINS.has(domain)) {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
  }
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replaceAll(".", "");
  }
  // `+` より前が空になる (`+foo@gmail.com`) 場合は潰さない。ローカル部が消えて
  // 全員が同じ正規形になってしまうため。
  if (local.length === 0) return `${parts.local}@${domain}`;

  return `${local}@${domain}`;
}
