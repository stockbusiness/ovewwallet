import { referralCookieDomain, referralCookieOptions } from "./referral-cookie";

const PROD = { APP_URL: "https://sennokuni-wallet.com" };

describe("紹介Cookieを共有させるドメイン", () => {
  it("APIがウォレットドメインの配下なら、共通の親ドメインを付ける", () => {
    // これが無いとCookieがAPIホスト専用になり、ログイン時に送られない
    expect(referralCookieDomain("api.sennokuni-wallet.com", PROD)).toBe("sennokuni-wallet.com");
  });

  it("ウォレットと同じホストで受けているなら付けない (共有の必要が無い)", () => {
    expect(referralCookieDomain("sennokuni-wallet.com", PROD)).toBeUndefined();
  });

  it("APIが別ドメインで受けているなら付けない", () => {
    // 無関係なDomainを指定するとブラウザはCookieを丸ごと拒否し、今より悪くなる
    expect(referralCookieDomain("ove-api.up.railway.app", PROD)).toBeUndefined();
    expect(referralCookieDomain("example.com", PROD)).toBeUndefined();
  });

  it("似ているだけの別ドメインには広げない", () => {
    // "evil-sennokuni-wallet.com" は "sennokuni-wallet.com" で終わるが配下ではない
    expect(referralCookieDomain("evil-sennokuni-wallet.com", PROD)).toBeUndefined();
  });

  it("ローカル開発では付けない", () => {
    expect(referralCookieDomain("localhost", { APP_URL: "http://localhost:3000" })).toBeUndefined();
    expect(referralCookieDomain("127.0.0.1", { APP_URL: "http://127.0.0.1:3000" })).toBeUndefined();
  });

  it("APP_URLが未設定・不正なら付けない", () => {
    expect(referralCookieDomain("api.sennokuni-wallet.com", {})).toBeUndefined();
    expect(referralCookieDomain("api.sennokuni-wallet.com", { APP_URL: "not-a-url" })).toBeUndefined();
  });

  it("ホスト名が取れなければ付けない", () => {
    expect(referralCookieDomain(undefined, PROD)).toBeUndefined();
  });
});

describe("紹介Cookieの属性", () => {
  it("常にHttpOnly・Secure・SameSite=none・Path=/", () => {
    const options = referralCookieOptions("api.sennokuni-wallet.com", PROD);
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      domain: "sennokuni-wallet.com",
    });
  });

  it("共有できないときはdomainを含めない (キーごと落とす)", () => {
    const options = referralCookieOptions("localhost", { APP_URL: "http://localhost:3000" });
    expect(options).not.toHaveProperty("domain");
  });
});
