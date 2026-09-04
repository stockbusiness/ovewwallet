import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { describeLineLoginError } from "./line-login-error";

describe("describeLineLoginError", () => {
  it("explains the terms requirement in Japanese instead of relaying the API text", () => {
    const info = describeLineLoginError(
      new ApiError(400, "terms of service agreement is required to create a new account"),
    );

    expect(info.message).toContain("利用規約");
    expect(info.message).not.toContain("terms of service");
  });

  it("does not keep retrying a terms failure", () => {
    // 同意なしのIDトークンは何度送っても通らない。送信待ちに残すと、
    // 再送上限に達するまで同じ失敗を繰り返す。
    expect(describeLineLoginError(new ApiError(400, "...")).retryable).toBe(false);
  });

  it("does not keep retrying a closed account", () => {
    const info = describeLineLoginError(new ApiError(403, "this account has been closed"));

    expect(info.message).toContain("退会済み");
    expect(info.retryable).toBe(false);
  });

  it("relays the API message and allows a retry for other statuses", () => {
    const info = describeLineLoginError(new ApiError(401, "LINEのIDトークンの有効期限が切れています"));

    expect(info).toEqual({
      message: "LINEのIDトークンの有効期限が切れています",
      retryable: true,
    });
  });

  it("falls back to a generic message for non-API errors", () => {
    expect(describeLineLoginError(new Error("boom"))).toEqual({
      message: "LINEログインに失敗しました",
      retryable: true,
    });
  });
});
