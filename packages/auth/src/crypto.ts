import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHmac, createHash } from "node:crypto";

const SCRYPT_KEYLEN = 64;

/**
 * パスワード・APIキー・OTP・セッショントークンなど「平文保存禁止」対象を
 * salt:hash 形式で保存するためのハッシュ化。bcrypt 等の native 依存を避け
 * Node 標準の scrypt を使う。
 */
export function hashSecret(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifySecret(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(plain, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** セッショントークン・SSOコード・APIキーなど、乱数由来の不透明トークンを生成する。 */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * 高エントロピーな乱数トークン (セッショントークン等) をDBの検索キーとして
 * 保存するための決定的ハッシュ。scrypt (hashSecret) はソルトが毎回変わるため
 * 完全一致検索には使えない — トークン自体に十分なエントロピーがあるため、
 * パスワードのような低速ハッシュは不要で SHA-256 で十分安全。
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** メールワンタイムコード: 6桁の数値文字列。 */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** 外部サービスAPI向け HMAC-SHA256 署名。 */
export function hmacSign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function hmacVerify(secret: string, payload: string, signature: string): boolean {
  const expected = hmacSign(secret, payload);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
