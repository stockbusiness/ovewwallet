import { MailSendError, ResendMailSender } from "./resend-mail-sender";

const originalFetch = global.fetch;

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  global.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  global.fetch = originalFetch;
});

const sender = new ResendMailSender({ apiKey: "re_secret", from: "no-reply@example.com" });
const message = { to: "user@example.com", subject: "件名", text: "本文 123456" };

describe("Resendへの送信", () => {
  it("差出人・宛先・件名・本文をそのまま渡す", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    await sender.send(message);

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({
      from: "no-reply@example.com",
      to: ["user@example.com"],
      subject: "件名",
      text: "本文 123456",
    });
  });

  it("APIキーはAuthorizationヘッダーで渡す", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await sender.send(message);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_secret");
  });

  it("HTMLではなくプレーンテキストで送る (迷惑メール判定を避けるため)", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await sender.send(message);
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty("html");
  });

  it("拒否されたら例外を投げる (握り潰すと「送信しました」と嘘をつくことになる)", async () => {
    stubFetch(() => new Response(JSON.stringify({ name: "validation_error" }), { status: 422 }));
    await expect(sender.send(message)).rejects.toBeInstanceOf(MailSendError);
  });

  it("接続できなかった場合も例外を投げる", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    await expect(sender.send(message)).rejects.toBeInstanceOf(MailSendError);
  });

  it("例外メッセージにAPIキー・宛先・本文を含めない", async () => {
    stubFetch(() => new Response(JSON.stringify({ name: "x", message: "user@example.com is invalid" }), { status: 422 }));
    const err = await sender.send(message).then(
      () => null,
      (e: Error) => e,
    );

    expect(err).not.toBeNull();
    expect(err!.message).not.toContain("re_secret");
    expect(err!.message).not.toContain("user@example.com");
    expect(err!.message).not.toContain("123456");
  });
});
