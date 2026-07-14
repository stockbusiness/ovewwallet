import { generateOtpCode, hashSecret, verifySecret } from "./crypto";
import type { KeyValueStore } from "./kv-store";

const CODE_TTL_SECONDS = 10 * 60; // 有効期限10分
const RESEND_INTERVAL_SECONDS = 60; // 再送間隔60秒
const MAX_ATTEMPTS = 5; // 入力上限5回

export class OtpResendTooSoonError extends Error {
  constructor() {
    super("OTP resend requested before the 60 second cooldown elapsed");
    this.name = "OtpResendTooSoonError";
  }
}

export class OtpVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpVerificationError";
  }
}

interface OtpRecord {
  hash: string;
  attempts: number;
}

function codeKey(email: string): string {
  return `otp:code:${email.toLowerCase()}`;
}

function resendKey(email: string): string {
  return `otp:resend:${email.toLowerCase()}`;
}

/**
 * メールワンタイムコード認証。指示書10章の仕様 (6桁 / 10分 / 5回 / 60秒間隔 /
 * 最新コードのみ有効 / 平文保存禁止) をそのまま実装する。
 */
export class EmailOtpService {
  constructor(private readonly store: KeyValueStore) {}

  async issue(email: string): Promise<string> {
    const cooldown = await this.store.get(resendKey(email));
    if (cooldown) {
      throw new OtpResendTooSoonError();
    }

    const code = generateOtpCode();
    const record: OtpRecord = { hash: hashSecret(code), attempts: 0 };
    // 最新コードのみ有効: 上書き保存
    await this.store.set(codeKey(email), JSON.stringify(record), CODE_TTL_SECONDS);
    await this.store.set(resendKey(email), "1", RESEND_INTERVAL_SECONDS);
    return code;
  }

  async verify(email: string, code: string): Promise<boolean> {
    const raw = await this.store.get(codeKey(email));
    if (!raw) {
      throw new OtpVerificationError("code expired or not issued");
    }
    const record: OtpRecord = JSON.parse(raw);
    if (record.attempts >= MAX_ATTEMPTS) {
      await this.store.del(codeKey(email));
      throw new OtpVerificationError("max attempts exceeded");
    }

    const isValid = verifySecret(code, record.hash);
    if (!isValid) {
      record.attempts += 1;
      await this.store.set(codeKey(email), JSON.stringify(record), CODE_TTL_SECONDS);
      return false;
    }

    await this.store.del(codeKey(email));
    return true;
  }
}
