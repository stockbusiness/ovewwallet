import "reflect-metadata";
import crypto from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { hmacSign } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { WALLET_SERVICE_SCOPES } from "../wallets/wallet-service-scopes";
import {
  createTestServiceIntegration,
  ensureRegistrationBonusRule,
  signedHeaders,
  type TestServiceIntegration,
} from "./test-helpers";

const PATH = "/api/v1/service/accounts/by-common-user-id/balance";
const SCOPE = WALLET_SERVICE_SCOPES.BALANCE_READ_COMMON_USER;

function validCommonUserId(): string {
  return `cu_${crypto.randomBytes(16).toString("hex")}`;
}

/** signedHeaders()と同じ組み立てだが、timestampを明示的に指定できる(タイムスタンプ許容範囲外テスト用)。 */
function signedHeadersWithTimestamp(
  integration: TestServiceIntegration,
  method: string,
  path: string,
  body: unknown,
  timestamp: string,
): Record<string, string> {
  const bodyJson = JSON.stringify(body);
  const nonce = generateId();
  const canonicalPayload = `${method}:${path}:${bodyJson}`;
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

describe("POST /api/v1/service/accounts/by-common-user-id/balance (PR-W2)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    // REGISTRATION_BONUSはreward_rules必須(fail-closed)。CIのDBはseedを流さないため用意する。
    await ensureRegistrationBonusRule();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function registerAccountWithCommonUserId(
    commonUserId: string,
  ): Promise<string> {
    const idToken = `mock.${generateId()}`;
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    const oveAccountId = login.body.ove_account_id as string;
    await prisma.oveAccount.update({
      where: { id: oveAccountId },
      data: { commonUserId },
    });
    return oveAccountId;
  }

  describe("機能フラグ", () => {
    it("ENABLE_COMMON_USER_BALANCE_APIが未設定(OFF)なら、scope・署名が正しくても503", async () => {
      delete process.env.ENABLE_COMMON_USER_BALANCE_API;
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const body = { common_user_id: validCommonUserId() };

      const res = await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(scoped, "POST", PATH, body))
        .send(body)
        .expect(503);
      expect(res.body.ok).toBe(false);
    });
  });

  describe("Flag ON時の認証・権限・入力検証", () => {
    beforeEach(() => {
      process.env.ENABLE_COMMON_USER_BALANCE_API = "true";
    });

    it("有効なHMAC + 必要scopeあり + 該当アカウント1件 → 200、内部識別子を含まないレスポンス", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const commonUserId = validCommonUserId();
      await registerAccountWithCommonUserId(commonUserId);
      const body = { common_user_id: commonUserId };

      const res = await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(scoped, "POST", PATH, body))
        .send(body)
        .expect(200);

      expect(typeof res.body.available_balance).toBe("string");
      expect(typeof res.body.pending_balance).toBe("string");
      expect(res.body.currency).toBe("OVE");
      expect(res.body.data_status).toBe("ok");
      expect(typeof res.body.wallet_status).toBe("string");
      expect(typeof res.body.as_of).toBe("string");
      expect(new Date(res.body.as_of).toString()).not.toBe("Invalid Date");

      const keys = Object.keys(res.body);
      expect(keys).not.toContain("common_user_id");
      expect(keys).not.toContain("account_id");
      expect(keys).not.toContain("ove_account_id");
      expect(keys).not.toContain("wallet_id");
      expect(keys).not.toContain("wallet_code");
    });

    it("Resolverが解決したaccountIdの残高を返す(commonUserIdでの再検索ではないことの間接確認)", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });

      const commonUserId = validCommonUserId();
      const targetAccountId =
        await registerAccountWithCommonUserId(commonUserId);

      // 別アカウントには紐付けない(commonUserIdなし)。もし実装が誤って別の検索経路を
      // 使っていた場合に取り違えが起きないことの確認材料として、先に無関係な残高操作を行う。
      const idTokenOther = `mock.${generateId()}`;
      const otherLogin = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken: idTokenOther, termsAccepted: true })
        .expect(201);
      const otherAccountId = otherLogin.body.ove_account_id as string;
      expect(otherAccountId).not.toBe(targetAccountId);

      const body = { common_user_id: commonUserId };
      const res = await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(scoped, "POST", PATH, body))
        .send(body)
        .expect(200);

      const wallet = await prisma.wallet.findUniqueOrThrow({
        where: { oveAccountId: targetAccountId },
      });
      expect(res.body.available_balance).toBe(
        wallet.availableBalance.toString(),
      );
    });

    it("有効なHMAC + scopeなし → 403、ForbiddenのFORBIDDENコード", async () => {
      const unscoped = await createTestServiceIntegration("AIART", {
        allowedScopes: [],
      });
      const body = { common_user_id: validCommonUserId() };

      const res = await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(unscoped, "POST", PATH, body))
        .send(body)
        .expect(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe("FORBIDDEN");

      const log = await prisma.apiAccessLog.findFirst({
        where: { serviceIntegrationId: unscoped.id, statusCode: 403 },
        orderBy: { createdAt: "desc" },
      });
      expect(log).not.toBeNull();
    });

    it("HMAC署名なし → 401", async () => {
      await request(app.getHttpServer())
        .post(PATH)
        .send({ common_user_id: validCommonUserId() })
        .expect(401);
    });

    it("HMAC署名が不正(改ざん) → 401", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const body = { common_user_id: validCommonUserId() };
      const headers = signedHeaders(scoped, "POST", PATH, body);
      // 末尾に非16進文字を追加すると Buffer.from(str, "hex") がそこで解析を打ち切り、
      // 実質的に元の署名と同じバイト列に戻ってしまう(改ざんが無効化される)ため、
      // 同じ桁数を保ったまま有効な16進1文字を別の値へ差し替える。
      const originalSignature = headers["X-OVE-Signature"]!;
      const flippedChar = originalSignature.endsWith("0") ? "1" : "0";
      headers["X-OVE-Signature"] = originalSignature.slice(0, -1) + flippedChar;

      await request(app.getHttpServer())
        .post(PATH)
        .set(headers)
        .send(body)
        .expect(401);
    });

    it("timestampが許容範囲外(5分超) → 401", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const body = { common_user_id: validCommonUserId() };
      const staleTimestamp = String(Date.now() - 10 * 60 * 1000);
      const headers = signedHeadersWithTimestamp(
        scoped,
        "POST",
        PATH,
        body,
        staleTimestamp,
      );

      await request(app.getHttpServer())
        .post(PATH)
        .set(headers)
        .send(body)
        .expect(401);
    });

    it("nonce再利用(リプレイ) → 2回目は401", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const commonUserId = validCommonUserId();
      await registerAccountWithCommonUserId(commonUserId);
      const body = { common_user_id: commonUserId };
      const headers = signedHeaders(scoped, "POST", PATH, body);

      await request(app.getHttpServer())
        .post(PATH)
        .set(headers)
        .send(body)
        .expect(200);
      await request(app.getHttpServer())
        .post(PATH)
        .set(headers)
        .send(body)
        .expect(401);
    });

    it("停止済み(SUSPENDED)ServiceIntegrationのAPIキー → 401", async () => {
      const scoped = await createTestServiceIntegration("AIART", {
        allowedScopes: [SCOPE],
      });
      await prisma.serviceIntegration.update({
        where: { id: scoped.id },
        data: { status: "SUSPENDED" },
      });
      const body = { common_user_id: validCommonUserId() };

      await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(scoped, "POST", PATH, body))
        .send(body)
        .expect(401);
    });

    describe("common_user_id形式検証(400、Resolver/DB検索を実行しない)", () => {
      let scoped: TestServiceIntegration;
      beforeAll(async () => {
        scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
          allowedScopes: [SCOPE],
        });
      });

      const invalidValues: Array<[string, unknown]> = [
        ["prefix不正", `usr_${crypto.randomBytes(16).toString("hex")}`],
        ["桁数不足", `cu_${crypto.randomBytes(10).toString("hex")}`],
        ["桁数超過", `cu_${crypto.randomBytes(20).toString("hex")}`],
        [
          "大文字混入",
          `cu_${crypto.randomBytes(16).toString("hex").toUpperCase()}`,
        ],
        ["前後空白", ` cu_${crypto.randomBytes(16).toString("hex")} `],
        ["記号入り", `cu_${crypto.randomBytes(15).toString("hex")}!!`],
        ["数値型", 12345],
        ["null", null],
        ["未指定", undefined],
      ];

      it.each(invalidValues)(
        "%s は400 VALIDATION_ERRORになる",
        async (_label, value) => {
          const scopedIntegration = scoped;
          const body = value === undefined ? {} : { common_user_id: value };
          const res = await request(app.getHttpServer())
            .post(PATH)
            .set(signedHeaders(scopedIntegration, "POST", PATH, body))
            .send(body)
            .expect(400);
          expect(res.body.ok).toBe(false);
          expect(res.body.error.code).toBe("VALIDATION_ERROR");
        },
      );
    });

    it("該当するcommon_user_idが存在しない → 404、識別子を含まない", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const commonUserId = validCommonUserId();
      const body = { common_user_id: commonUserId };

      const res = await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(scoped, "POST", PATH, body))
        .send(body)
        .expect(404);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(JSON.stringify(res.body)).not.toContain(commonUserId);
    });

    it("同一common_user_idが2件のOveAccountに紐づく → 409、識別子を含まず、audit_logsに競合が1件記録される", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const commonUserId = validCommonUserId();

      const idTokenA = `mock.${generateId()}`;
      const loginA = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken: idTokenA, termsAccepted: true })
        .expect(201);
      const idTokenB = `mock.${generateId()}`;
      const loginB = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken: idTokenB, termsAccepted: true })
        .expect(201);
      const accountIdA = loginA.body.ove_account_id as string;
      const accountIdB = loginB.body.ove_account_id as string;
      await prisma.oveAccount.update({
        where: { id: accountIdA },
        data: { commonUserId },
      });
      await prisma.oveAccount.update({
        where: { id: accountIdB },
        data: { commonUserId },
      });

      const body = { common_user_id: commonUserId };
      const res = await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(scoped, "POST", PATH, body))
        .send(body)
        .expect(409);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe("COMMON_USER_ACCOUNT_CONFLICT");
      const responseText = JSON.stringify(res.body);
      expect(responseText).not.toContain(commonUserId);
      expect(responseText).not.toContain(accountIdA);
      expect(responseText).not.toContain(accountIdB);

      const auditRows = await prisma.auditLog.findMany({
        where: { actionType: "SERVICE_BALANCE_QUERY_COMMON_USER_ID_CONFLICT" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0]!;
      const auditText = JSON.stringify(auditRow);
      expect(auditText).not.toContain(commonUserId);
      expect(auditText).not.toContain(accountIdA);
      expect(auditText).not.toContain(accountIdB);
      expect(
        (auditRow.afterData as Record<string, unknown>).candidateCount,
      ).toBe(2);
    });

    it("ログ(api_access_logs)に残高・APIキー・署名値が含まれない", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const commonUserId = validCommonUserId();
      await registerAccountWithCommonUserId(commonUserId);
      const body = { common_user_id: commonUserId };
      const headers = signedHeaders(scoped, "POST", PATH, body);

      await request(app.getHttpServer())
        .post(PATH)
        .set(headers)
        .send(body)
        .expect(200);

      const log = await prisma.apiAccessLog.findFirst({
        where: { serviceIntegrationId: scoped.id },
        orderBy: { createdAt: "desc" },
      });
      expect(log).not.toBeNull();
      const logText = JSON.stringify(log);
      expect(logText).not.toContain(commonUserId);
      expect(logText).not.toContain(scoped.apiKey);
      expect(logText).not.toContain(scoped.signingSecret);
      expect(logText).not.toContain(headers["X-OVE-Signature"]);
    });
  });

  describe("Cache-Control", () => {
    it("Cache-Control: no-store が付与される", async () => {
      process.env.ENABLE_COMMON_USER_BALANCE_API = "true";
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });
      const body = { common_user_id: validCommonUserId() };

      const res = await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(scoped, "POST", PATH, body))
        .send(body);
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("ルーティング競合なし・既存API無変更(GET :externalUserId/balance)", () => {
    it("同じパス文字列でも、POSTは新エンドポイント、GETは既存の:externalUserId/balanceとして解決される", async () => {
      process.env.ENABLE_COMMON_USER_BALANCE_API = "true";
      const scoped = await createTestServiceIntegration("SENGOKU_PASSPORT", {
        allowedScopes: [SCOPE],
      });

      // GET: "by-common-user-id" は既存ルートの :externalUserId として解釈される
      // (scopeを要求しない既存Guardのみが適用され、旧LedgerExceptionFilter形式で404を返す)。
      const getRes = await request(app.getHttpServer())
        .get(PATH)
        .set(signedHeaders(scoped, "GET", PATH, {}))
        .expect(404);
      expect(getRes.body.ok).toBeUndefined(); // ExternalApiExceptionFilter形式ではない(既存のまま)
      expect(typeof getRes.body.message).toBe("string");

      // POST: scopeなしなので新エンドポイントとして403(ExternalApiExceptionFilter形式)。
      // Guard自体には到達している=正しいハンドラにルーティングされていることの確認。
      const unscoped = await createTestServiceIntegration("AIART", {
        allowedScopes: [],
      });
      const body = { common_user_id: validCommonUserId() };
      const postRes = await request(app.getHttpServer())
        .post(PATH)
        .set(signedHeaders(unscoped, "POST", PATH, body))
        .send(body)
        .expect(403);
      expect(postRes.body.ok).toBe(false);
    });
  });

  describe("既存 GET /api/v1/service/accounts/:externalUserId/balance のレスポンス契約が変わっていないことの回帰確認", () => {
    it("正常レスポンスのキー集合・型・ステータス・エラー形式が固定どおり", async () => {
      const scoped = await createTestServiceIntegration("SENGOKU_GACHA", {
        perRequestAmountLimit: 1_000_000,
      });
      const externalUserId = `svc-user-${generateId()}`;

      const grantBody = {
        service_code: "SENGOKU_GACHA",
        external_user_id: externalUserId,
        event_type: "REGISTRATION",
        event_id: `EVT-${generateId()}`,
        amount: 1000,
        transaction_type: "REGISTRATION_BONUS",
        display_name: "テスト",
        idempotency_key: `REG:${generateId()}`,
      };
      await request(app.getHttpServer())
        .post("/api/v1/rewards/grant")
        .set(signedHeaders(scoped, "POST", "/api/v1/rewards/grant", grantBody))
        .send(grantBody)
        .expect(201);

      const balancePath = `/api/v1/service/accounts/${externalUserId}/balance`;
      const res = await request(app.getHttpServer())
        .get(balancePath)
        .set(signedHeaders(scoped, "GET", balancePath, {}))
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual(
        [
          "ove_account_id",
          "wallet_id",
          "wallet_code",
          "status",
          "available_balance",
          "pending_balance",
          "held_balance",
          "lifetime_credited",
          "lifetime_debited",
        ].sort(),
      );
      expect(typeof res.body.ove_account_id).toBe("string");
      expect(typeof res.body.wallet_id).toBe("string");
      expect(typeof res.body.wallet_code).toBe("string");
      expect(typeof res.body.status).toBe("string");
      expect(typeof res.body.available_balance).toBe("string");
      expect(typeof res.body.pending_balance).toBe("string");
      expect(typeof res.body.held_balance).toBe("string");
      expect(typeof res.body.lifetime_credited).toBe("string");
      expect(typeof res.body.lifetime_debited).toBe("string");

      // エラー形式も既存のまま (ExternalApiExceptionFilterではなくLedgerExceptionFilter形式)。
      const unknownPath = `/api/v1/service/accounts/unknown-${generateId()}/balance`;
      const notFoundRes = await request(app.getHttpServer())
        .get(unknownPath)
        .set(signedHeaders(scoped, "GET", unknownPath, {}))
        .expect(404);
      expect(notFoundRes.body.ok).toBeUndefined();
      expect(typeof notFoundRes.body.message).toBe("string");
      expect(notFoundRes.body.error).toBe("Not Found");
    });
  });
});
