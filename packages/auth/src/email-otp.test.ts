import { describe, expect, it } from "vitest";
import { InMemoryKeyValueStore } from "./kv-store";
import { EmailOtpService, OtpResendTooSoonError, OtpVerificationError } from "./email-otp";

describe("EmailOtpService", () => {
  it("issues a 6-digit code and verifies it once", async () => {
    const service = new EmailOtpService(new InMemoryKeyValueStore());
    const code = await service.issue("user@example.com");

    expect(code).toMatch(/^\d{6}$/);
    await expect(service.verify("user@example.com", code)).resolves.toBe(true);
    // 検証成功後は消費されるため、同じコードは再度使えない
    await expect(service.verify("user@example.com", code)).rejects.toBeInstanceOf(
      OtpVerificationError,
    );
  });

  it("rejects an incorrect code without consuming it and increments attempts", async () => {
    const service = new EmailOtpService(new InMemoryKeyValueStore());
    const code = await service.issue("user@example.com");

    await expect(service.verify("user@example.com", "000000")).resolves.toBe(false);
    // 正しいコードならまだ有効
    await expect(service.verify("user@example.com", code)).resolves.toBe(true);
  });

  it("locks out after 5 failed attempts", async () => {
    const service = new EmailOtpService(new InMemoryKeyValueStore());
    await service.issue("user@example.com");

    for (let i = 0; i < 5; i++) {
      await service.verify("user@example.com", "000000");
    }

    await expect(service.verify("user@example.com", "000000")).rejects.toBeInstanceOf(
      OtpVerificationError,
    );
  });

  it("enforces the 60 second resend cooldown", async () => {
    const service = new EmailOtpService(new InMemoryKeyValueStore());
    await service.issue("user@example.com");

    await expect(service.issue("user@example.com")).rejects.toBeInstanceOf(
      OtpResendTooSoonError,
    );
  });

  it("only the latest issued code is valid", async () => {
    const store = new InMemoryKeyValueStore();
    const service = new EmailOtpService(store);
    const first = await service.issue("user@example.com");
    // 60秒クールダウンを回避するため、テストではストアを直接クリアして再発行する
    await store.del("otp:resend:user@example.com");
    const second = await service.issue("user@example.com");

    expect(first).not.toBe(second);
    await expect(service.verify("user@example.com", first)).resolves.toBe(false);
    await expect(service.verify("user@example.com", second)).resolves.toBe(true);
  });
});
