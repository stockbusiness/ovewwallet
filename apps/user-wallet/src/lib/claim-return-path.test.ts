import { describe, expect, it } from "vitest";
import { sanitizeInternalReturnPath } from "./claim-return-path";

describe("sanitizeInternalReturnPath (NFTカードClaim導線実装指示書5章)", () => {
  it("許可Prefix配下の内部パスは通す", () => {
    expect(sanitizeInternalReturnPath("/claim/abc123")).toBe("/claim/abc123");
  });

  it("nullまたはundefinedはnullを返す (Return Pathなし → /walletへの既定遷移用)", () => {
    expect(sanitizeInternalReturnPath(null)).toBeNull();
    expect(sanitizeInternalReturnPath(undefined)).toBeNull();
    expect(sanitizeInternalReturnPath("")).toBeNull();
  });

  it("許可Prefix以外の内部パスは拒否する", () => {
    expect(sanitizeInternalReturnPath("/wallet")).toBeNull();
    expect(sanitizeInternalReturnPath("/admin/secret")).toBeNull();
  });

  it("外部URL(絶対URL)は拒否する", () => {
    expect(sanitizeInternalReturnPath("https://external.example.com")).toBeNull();
    expect(sanitizeInternalReturnPath("http://evil.example/claim/x")).toBeNull();
  });

  it("プロトコル相対URL(//evil.example)は拒否する", () => {
    expect(sanitizeInternalReturnPath("//evil.example")).toBeNull();
    expect(sanitizeInternalReturnPath("//evil.example/claim/x")).toBeNull();
  });

  it("バックスラッシュを使った回避も拒否する", () => {
    expect(sanitizeInternalReturnPath("/\\evil.example")).toBeNull();
  });

  it("javascript:/data:スキームは拒否する", () => {
    expect(sanitizeInternalReturnPath("javascript:alert(1)")).toBeNull();
    expect(sanitizeInternalReturnPath("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("最大長を超える値は拒否する", () => {
    const tooLong = "/claim/" + "a".repeat(200);
    expect(sanitizeInternalReturnPath(tooLong)).toBeNull();
  });
});
