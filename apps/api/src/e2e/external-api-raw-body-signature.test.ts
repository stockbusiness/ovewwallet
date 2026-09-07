import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { hmacSign } from "@ove/auth";
import { generateId } from "@ove/database";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration, type TestServiceIntegration } from "./test-helpers";

/**
 * X-OVE-* 署名 (ExternalApiAuthGuard) が「受け取った生ボディ」に対して行われることを確認する。
 *
 * 以前はパース後のオブジェクトを `JSON.stringify` し直した文字列を検証対象にしていたため、
 * 連携先は「自分が送ったバイト列」ではなく「Nodeが再文字列化した結果」を当てる必要があり、
 * 日本語のエスケープ方式・キー順序・インデントが1バイトでも違うと 401 になっていた。
 * 生ボディ方式では「送るものにそのまま署名する」だけで通る。
 */
describe("X-OVE-*署名は生ボディに対して行われる", () => {
  let app: INestApplication;
  let integration: TestServiceIntegration;

  const GRANT_PATH = "/api/v1/rewards/grant";

  /** signedHeaders()と同じだが、署名対象の本文文字列を呼び出し側が完全に指定できる。 */
  function headersForRawBody(method: string, path: string, rawBody: string): Record<string, string> {
    const timestamp = String(Date.now());
    const nonce = generateId();
    const canonicalPayload = `${method}:${path}:${rawBody}`;
    const signature = hmacSign(
      integration.signingSecret,
      `${timestamp}.${nonce}.${canonicalPayload}`,
    );
    return {
      "X-OVE-Api-Key": integration.apiKey,
      "X-OVE-Timestamp": timestamp,
      "X-OVE-Nonce": nonce,
      "X-OVE-Signature": signature,
    };
  }

  function grantBody(): Record<string, unknown> {
    return {
      service_code: "AIART",
      external_user_id: `raw-body-${generateId()}`,
      event_type: "attendance",
      event_id: `event-${generateId()}`,
      amount: 100,
      display_name: "生ボディ署名テスト",
      idempotency_key: `grant-${generateId()}`,
    };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    integration = await createTestServiceIntegration("AIART", { perRequestAmountLimit: 1_000_000 });
  });

  afterAll(async () => {
    await app.close();
  });

  it("整形済み・日本語そのままの本文でも、そのバイト列に署名すれば通る", async () => {
    // インデント付き + 日本語を \uXXXX にエスケープしない、という
    // 「Node の JSON.stringify とは異なる」直列化。連携先の言語によっては普通に起こる。
    const rawBody = JSON.stringify(grantBody(), null, 2);
    expect(rawBody).toContain("生ボディ署名テスト");
    expect(rawBody).toContain("\n");

    await request(app.getHttpServer())
      .post(GRANT_PATH)
      .set(headersForRawBody("POST", GRANT_PATH, rawBody))
      .type("application/json")
      .send(rawBody)
      .expect(201);
  });

  it("送った本文と違う文字列 (再直列化した正規形) に署名すると 401 になる", async () => {
    const body = grantBody();
    const rawBody = JSON.stringify(body, null, 2);
    // 送信するのは整形済みの rawBody だが、署名するのは詰めた形。旧実装ではこちらが通っていた。
    const compact = JSON.stringify(body);
    expect(compact).not.toBe(rawBody);

    await request(app.getHttpServer())
      .post(GRANT_PATH)
      .set(headersForRawBody("POST", GRANT_PATH, compact))
      .type("application/json")
      .send(rawBody)
      .expect(401);
  });

  it("本文の無いGETは空文字に署名する", async () => {
    // 存在しないアカウントを指定するので 404 になるが、401 でない = 認証を通過したということ。
    const path = `/api/v1/service/accounts/unknown-${generateId()}/balance`;
    await request(app.getHttpServer())
      .get(path)
      .set(headersForRawBody("GET", path, ""))
      .expect(404);
  });

  it('本文の無いGETで "{}" に署名すると 401 になる', async () => {
    const path = `/api/v1/service/accounts/unknown-${generateId()}/balance`;
    await request(app.getHttpServer())
      .get(path)
      .set(headersForRawBody("GET", path, "{}"))
      .expect(401);
  });
});
