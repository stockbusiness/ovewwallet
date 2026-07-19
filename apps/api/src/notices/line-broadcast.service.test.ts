import { LineBroadcastService } from "./line-broadcast.service";

describe("LineBroadcastService (LINE_MESSAGING_CHANNEL_ACCESS_TOKEN未設定時はno-op)", () => {
  const originalToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
    else process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = originalToken;
    global.fetch = originalFetch;
  });

  it("does not call fetch when the token is unset", async () => {
    delete process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new LineBroadcastService();

    await service.broadcastText("test");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the LINE broadcast endpoint with the bearer token when set", async () => {
    process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "test-token";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new LineBroadcastService();

    await service.broadcastText("【お知らせ】テスト");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/broadcast");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ type: "text", text: "【お知らせ】テスト" }],
    });
  });

  it("throws when LINE responds with a non-2xx status", async () => {
    process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "test-token";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid channel access token",
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new LineBroadcastService();

    await expect(service.broadcastText("test")).rejects.toThrow(/status=401/);
  });
});
