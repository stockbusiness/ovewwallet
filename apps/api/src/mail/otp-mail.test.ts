import { buildOtpMail, OTP_CODE_TTL_MINUTES } from "./otp-mail";

describe("ワンタイムコードのメール本文", () => {
  const mail = buildOtpMail({ to: "user@example.com", code: "123456" });

  it("宛先と件名にコードを入れる (受信箱の一覧だけで確認できるように)", () => {
    expect(mail.to).toBe("user@example.com");
    expect(mail.subject).toContain("123456");
  });

  it("本文にコードと有効期限を書く", () => {
    expect(mail.text).toContain("123456");
    expect(mail.text).toContain(`${OTP_CODE_TTL_MINUTES}分`);
  });

  it("リンクを一切置かない", () => {
    // 「メールのリンクを踏む」習慣をつけると、偽メールで誘導されたときに
    // 見分けがつかなくなる。コードは手で入力してもらう
    expect(mail.text).not.toMatch(/https?:\/\//);
  });

  it("コードを他人に伝えないよう注意書きを入れる", () => {
    expect(mail.text).toContain("他の人に伝えないで");
  });
});
