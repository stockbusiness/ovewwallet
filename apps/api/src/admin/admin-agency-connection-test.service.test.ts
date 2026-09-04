import { AdminAgencyConnectionTestService } from "./admin-agency-connection-test.service";
import type { IntegrationHttpClient } from "../integrations/integration-http-client";
import type { IntegrationConfigProvider } from "../integrations/integration-config-provider";

/**
 * 接続テストは「何が悪いのか」を管理者に伝えるのが目的なので、
 * 応答の種類ごとに違う結論を出せることを固定する。
 *
 * あわせて、副作用を出さない問い合わせであること (create_if_missing: false) と、
 * 監査ログにAPIキーを残さないことも確認する。
 */
type Ctor = ConstructorParameters<typeof AdminAgencyConnectionTestService>;

function build(options: {
  config?: { baseUrl: string; systemKey: string; apiKey: string } | null;
  response?: unknown;
  /** 呼び出し順に返す応答。指定時は `response` より優先する。 */
  responses?: unknown[];
}) {
  const created: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];

  const db = {
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
      },
    },
  } as unknown as Ctor[0];

  const http = {
    request: async (params: Record<string, unknown>) => {
      requests.push(params);
      if (options.responses) {
        return options.responses[requests.length - 1] ?? { ok: true, data: {} };
      }
      return options.response ?? { ok: true, data: {} };
    },
  } as unknown as IntegrationHttpClient;

  const configProvider = {
    resolveAgencySystemConfigIgnoringFlag: async () =>
      options.config === undefined
        ? { baseUrl: "https://sengoku-ai.com", systemKey: "orly-wallet", apiKey: "secret-key" }
        : options.config,
  } as unknown as IntegrationConfigProvider;

  return {
    service: new AdminAgencyConnectionTestService(db, http, configProvider),
    created,
    requests,
  };
}

describe("AdminAgencyConnectionTestService", () => {
  it("APIキー未設定なら、外部へ発信せず設定を促す", async () => {
    const { service, requests } = build({ config: null });

    const result = await service.run("adm_1");

    expect(result.outcome).toBe("not_configured");
    expect(requests).toHaveLength(0);
  });

  it("相手側に何も作らない問い合わせを送る (create_if_missing: false)", async () => {
    const { service, requests } = build({});

    await service.run("adm_1");

    expect(requests).toHaveLength(1);
    const body = requests[0]!["body"] as Record<string, unknown>;
    expect(body["create_if_missing"]).toBe(false);
    expect(body["system_key"]).toBe("orly-wallet");
    expect(requests[0]!["path"]).toBe("/api/common-users/resolve");
  });

  it("応答があれば疎通OKとする (共通顧客が見つからなくてもよい)", async () => {
    const { service } = build({ response: { ok: true, data: { ok: false } } });

    const result = await service.run("adm_1");

    expect(result.outcome).toBe("ok");
    expect(result.requestUrl).toBe("https://sengoku-ai.com/api/common-users/resolve");
  });

  it("401はAPIキーの不一致として案内する", async () => {
    const { service } = build({
      response: { ok: false, error: { kind: "http_4xx", status: 401, retryable: false, message: "HTTP 401" } },
    });

    const result = await service.run("adm_1");

    expect(result.outcome).toBe("unauthorized");
    expect(result.message).toContain("APIキー");
  });

  it("404は送信先URLの誤りとして案内する", async () => {
    const { service } = build({
      response: { ok: false, error: { kind: "http_4xx", status: 404, retryable: false, message: "HTTP 404" } },
    });

    expect((await service.run("adm_1")).outcome).toBe("not_found");
  });

  it("接続できない場合は到達不能として案内する", async () => {
    const { service } = build({
      response: { ok: false, error: { kind: "timeout", retryable: true, message: "timeout" } },
    });

    expect((await service.run("adm_1")).outcome).toBe("unreachable");
  });

  it("監査ログを残し、APIキーは記録しない", async () => {
    const { service, created } = build({});

    await service.run("adm_42");

    expect(created).toHaveLength(1);
    const log = created[0]!;
    expect(log["actionType"]).toBe("AGENCY_CONNECTION_TEST");
    expect(log["actorId"]).toBe("adm_42");
    expect(log["result"]).toBe("SUCCESS");
    expect(JSON.stringify(log)).not.toContain("secret-key");
  });

  it("失敗した接続テストもFAILUREとして監査ログに残す", async () => {
    const { service, created } = build({
      response: { ok: false, error: { kind: "http_4xx", status: 401, retryable: false, message: "HTTP 401" } },
    });

    await service.run("adm_1");

    expect(created[0]!["result"]).toBe("FAILURE");
  });
});

describe("AdminAgencyConnectionTestService: 認証まわりの案内", () => {
  const forbidden = {
    ok: false,
    error: {
      kind: "http_4xx",
      status: 403,
      retryable: false,
      message: "HTTP 403",
      body: { error: "missing scope: common_users:write" },
    },
  };

  it("通常経路と同じ x-api-key で送る", async () => {
    const { service, requests } = build({});

    await service.run("adm_1");

    expect(requests).toHaveLength(1);
    expect(requests[0]!["apiKey"]).toBe("secret-key");
    expect(requests[0]!["extraHeaders"]).toBeUndefined();
  });

  it("403は権限不足として案内し、401の「キーの不一致」とは分ける", async () => {
    const { service } = build({ response: forbidden });

    const result = await service.run("adm_1");

    expect(result.outcome).toBe("unauthorized");
    expect(result.message).toContain("許可されていません");
    expect(result.message).toContain("common_users:write");
    expect(result.message).not.toContain("認識されませんでした");
  });

  it("401はキーの不一致として案内する", async () => {
    const { service } = build({
      response: { ok: false, error: { kind: "http_4xx", status: 401, retryable: false, message: "HTTP 401" } },
    });

    const result = await service.run("adm_1");

    expect(result.message).toContain("認識されませんでした");
    expect(result.message).not.toContain("common_users:write");
  });

  it("連携先の応答本文を切り分け用に残す", async () => {
    const { service } = build({ response: forbidden });

    const result = await service.run("adm_1");

    expect(result.partnerResponse).toContain("common_users:write");
  });

  it("疎通OKでも、書き込み権限までは確認できない旨を伝える", async () => {
    const { service } = build({});

    const result = await service.run("adm_1");

    expect(result.outcome).toBe("ok");
    expect(result.message).toContain("common_users:write");
  });
});
