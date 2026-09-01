import { InvalidLandingUrlError, normalizeLandingUrl } from "./landing-url";

describe("normalizeLandingUrl", () => {
  it("httpsのURLはそのまま通す", () => {
    expect(normalizeLandingUrl("https://lin.ee/abc123")).toBe("https://lin.ee/abc123");
    expect(normalizeLandingUrl("  https://example.com/join?utm_source=wallet  ")).toBe(
      "https://example.com/join?utm_source=wallet",
    );
  });

  it("未設定・空文字はnull (管理画面でURLを外せるようにするため)", () => {
    expect(normalizeLandingUrl(undefined)).toBeNull();
    expect(normalizeLandingUrl(null)).toBeNull();
    expect(normalizeLandingUrl("")).toBeNull();
    expect(normalizeLandingUrl("   ")).toBeNull();
  });

  it("https以外は拒否する", () => {
    // 利用者の画面でそのままリンクになるため、スクリプトを実行しうるスキームを弾く
    for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "http://example.com"]) {
      expect(() => normalizeLandingUrl(url)).toThrow(InvalidLandingUrlError);
    }
  });

  it("URLとして解釈できない値は拒否する", () => {
    for (const value of ["lin.ee/abc", "not a url", "/relative/path"]) {
      expect(() => normalizeLandingUrl(value)).toThrow(InvalidLandingUrlError);
    }
  });
});
