/**
 * PR#2最終修正 P1-2。`entitlement.granted`のmetadata.image_url/thumbnail_urlや
 * 管理画面のカードマスター編集で受け取る画像URLの安全性を検証する共有バリデーター。
 * SSRF対策 (localhost/loopback/private IP/link-localの拒否) と、HTTPS限定・SVG拒否・
 * URL長上限を課す。`COLLECTIBLE_IMAGE_ALLOWED_HOSTS`が設定されている場合のみ
 * ホスト許可リストも適用する (未設定時は上記の拒否条件のみで判定するopt-in方式)。
 */
export class InvalidCollectibleImageUrlError extends Error {}

const MAX_URL_LENGTH = 2048;

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

function isPrivateOrLoopbackIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if (a > 255 || b > 255) return false;
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateOrLoopbackIpv6(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "::1" || host === "::") return true;
  if (host.startsWith("fe80:")) return true; // link-local fe80::/10
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique local fc00::/7
  return false;
}

function isDisallowedHostname(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isPrivateOrLoopbackIpv4(host)) return true;
  if (host.includes(":") && isPrivateOrLoopbackIpv6(host)) return true;
  return false;
}

function getAllowedHosts(): string[] {
  const raw = process.env["COLLECTIBLE_IMAGE_ALLOWED_HOSTS"] ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** 不正な場合は`InvalidCollectibleImageUrlError`を投げる。呼び出し側で用途に応じて変換する。 */
export function assertValidCollectibleImageUrl(rawUrl: string): void {
  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new InvalidCollectibleImageUrlError(`image URL exceeds ${MAX_URL_LENGTH} characters`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new InvalidCollectibleImageUrlError("image URL is not a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new InvalidCollectibleImageUrlError("image URL must use https://");
  }
  if (parsed.pathname.toLowerCase().endsWith(".svg")) {
    throw new InvalidCollectibleImageUrlError("SVG images are not allowed");
  }

  const hostname = stripBrackets(parsed.hostname.toLowerCase());
  if (isDisallowedHostname(hostname)) {
    throw new InvalidCollectibleImageUrlError(`image URL hostname "${hostname}" is not allowed`);
  }

  const allowedHosts = getAllowedHosts();
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    throw new InvalidCollectibleImageUrlError(`image URL hostname "${hostname}" is not in COLLECTIBLE_IMAGE_ALLOWED_HOSTS`);
  }
}

export function isValidCollectibleImageUrl(rawUrl: string): boolean {
  try {
    assertValidCollectibleImageUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
