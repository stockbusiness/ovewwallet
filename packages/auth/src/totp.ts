import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 4226 HOTP。TOTP (RFC 6238) はこの counter に unix time / step を渡したもの。 */
function hotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter % 2 ** 32, 4);

  const hmac = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binCode % 10 ** digits).toString().padStart(digits, "0");
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface TotpOptions {
  digits?: number;
  stepSeconds?: number;
  /** 前後何ステップまで時計ずれを許容するか (既定1 = ±30秒)。 */
  window?: number;
}

/** 管理画面MFA (指示書13章) 用のTOTPシークレットをBase32で生成する。 */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function computeTotpCode(base32Secret: string, forTimeMs = Date.now(), options: TotpOptions = {}): string {
  const digits = options.digits ?? 6;
  const step = options.stepSeconds ?? 30;
  const counter = Math.floor(forTimeMs / 1000 / step);
  return hotp(base32Decode(base32Secret), counter, digits);
}

/** 認証アプリ (Google Authenticator等) が入力したコードを、時計ずれを許容して検証する。 */
export function verifyTotpCode(
  base32Secret: string,
  code: string,
  forTimeMs = Date.now(),
  options: TotpOptions = {},
): boolean {
  const normalizedCode = code.trim();
  if (!/^\d+$/.test(normalizedCode)) return false;

  const digits = options.digits ?? 6;
  const step = options.stepSeconds ?? 30;
  const window = options.window ?? 1;
  const counter = Math.floor(forTimeMs / 1000 / step);
  const secretBytes = base32Decode(base32Secret);

  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = hotp(secretBytes, counter + errorWindow, digits);
    if (timingSafeEqualStrings(candidate, normalizedCode)) return true;
  }
  return false;
}

/** 認証アプリでのQRコード読み取り用 otpauth:// URI (RFC準拠)。 */
export function buildTotpUri(params: { secret: string; accountName: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
