import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveKey(encryptionKey: string): Buffer {
  // ENCRYPTION_KEY (任意長の文字列) から AES-256 用の32byte鍵を導出する。
  return scryptSync(encryptionKey, "ove-wallet-platform", 32);
}

/**
 * HMAC署名用シークレットなど、サーバー側で平文を再取得する必要がある値の
 * 可逆暗号化。APIキーのような「照合のみ」で済む値は hashSecret (一方向) を使い、
 * 外部サービスへの署名検証のように平文が必要な値だけこちらを使う。
 */
export function encryptSecret(plain: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptSecret(payload: string, encryptionKey: string): string {
  const [ivHex, authTagHex, dataHex] = payload.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("malformed encrypted secret payload");
  }
  const key = deriveKey(encryptionKey);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
