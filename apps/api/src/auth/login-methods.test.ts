import { availableLoginMethods, isLoginMethodEnabled } from "./login-methods";

describe("ログイン方法の有効・無効", () => {
  it("既定ではLINEのみ有効", () => {
    // 稼働開始時点で実際に使えるのはLINEだけ (docs/login-methods.md)
    expect(availableLoginMethods({})).toEqual({
      line: true,
      email: false,
      sengoku_passport: false,
      agency: false,
    });
  });

  it("LINEは明示的にfalseにしたときだけ無効になる", () => {
    // 設定漏れで誰もログインできなくなる方が害が大きいため、既定で有効
    expect(isLoginMethodEnabled("line", {})).toBe(true);
    expect(isLoginMethodEnabled("line", { ENABLE_LINE_LOGIN: "true" })).toBe(true);
    expect(isLoginMethodEnabled("line", { ENABLE_LINE_LOGIN: "false" })).toBe(false);
  });

  it("LINE以外はtrueにしたときだけ有効になる (Feature Flagと同じ既定OFF)", () => {
    expect(isLoginMethodEnabled("email", {})).toBe(false);
    expect(isLoginMethodEnabled("email", { ENABLE_EMAIL_LOGIN: "1" })).toBe(false);
    expect(isLoginMethodEnabled("email", { ENABLE_EMAIL_LOGIN: "TRUE" })).toBe(false);
    expect(isLoginMethodEnabled("email", { ENABLE_EMAIL_LOGIN: "true" })).toBe(true);
  });

  it("メール送信基盤ができたら環境変数だけで開けられる", () => {
    expect(availableLoginMethods({ ENABLE_EMAIL_LOGIN: "true" })).toEqual({
      line: true,
      email: true,
      sengoku_passport: false,
      agency: false,
    });
  });
});
