import { createMailSender } from "./mail.module";
import { NoopMailSender } from "./mail-sender";
import { ResendMailSender } from "./resend-mail-sender";

describe("送信実装の選択", () => {
  it("RESEND_API_KEYが無ければ何も送らない実装を使う (Redis無しでも開発できるのと同じ方針)", () => {
    expect(createMailSender({})).toBeInstanceOf(NoopMailSender);
  });

  it("RESEND_API_KEYがあればResendを使う", () => {
    expect(createMailSender({ RESEND_API_KEY: "re_test" })).toBeInstanceOf(ResendMailSender);
  });
});
