import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import {
  createTestServiceIntegration,
  ensureRegistrationBonusRule,
  signedHeaders,
  type TestServiceIntegration,
} from "./test-helpers";

/**
 * 開発ガイドライン12章「本番公開前の必須項目」: 本人用/管理者用/外部サービス用でAPIを
 * 分離し、URLでOVE_ACCOUNT_IDを直接受け取らないこと・外部サービスが自サービスに
 * 紐づかない利用者を照会できないことを検証する。
 */
describe("本人用API (/me) と外部サービス用API (/service/accounts) の分離", () => {
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

  it("旧来の /api/v1/wallets/:oveAccountId/* エンドポイントはもう存在しない", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    await request(server).get(`/api/v1/wallets/${login.body.ove_account_id}/balance`).expect(404);
  });

  it("/api/v1/me/wallet と /me/transactions はセッションから本人を特定し、他人には見えない", async () => {
    const server = app.getHttpServer();

    const idTokenA = `mock.${generateId()}`;
    const loginA = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenA, termsAccepted: true }).expect(201);
    const cookieA = loginA.headers["set-cookie"] as unknown as string[];

    const idTokenB = `mock.${generateId()}`;
    const loginB = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenB, termsAccepted: true }).expect(201);
    const cookieB = loginB.headers["set-cookie"] as unknown as string[];

    const balanceA = await request(server).get("/api/v1/me/wallet").set("Cookie", cookieA).expect(200);
    expect(balanceA.body.ove_account_id).toBe(loginA.body.ove_account_id);

    const balanceB = await request(server).get("/api/v1/me/wallet").set("Cookie", cookieB).expect(200);
    expect(balanceB.body.ove_account_id).toBe(loginB.body.ove_account_id);
    expect(balanceB.body.ove_account_id).not.toBe(balanceA.body.ove_account_id);

    // セッションなしでは拒否される (URLでOVE_ACCOUNT_IDを渡す余地がそもそもない)
    await request(server).get("/api/v1/me/wallet").expect(401);
    await request(server).get("/api/v1/me/transactions").expect(401);
  });

  it("/api/v1/me/transactions/:transactionId は本人の取引のみ返し、他人の取引は404になる", async () => {
    const server = app.getHttpServer();

    const idTokenA = `mock.${generateId()}`;
    const loginA = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenA, termsAccepted: true }).expect(201);
    const cookieA = loginA.headers["set-cookie"] as unknown as string[];

    const idTokenB = `mock.${generateId()}`;
    const loginB = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenB, termsAccepted: true }).expect(201);
    const cookieB = loginB.headers["set-cookie"] as unknown as string[];

    const adminEmail = `e2e-me-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    const { hashSecret } = await import("@ove/auth");
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Me Admin",
      },
    });
    const adminLogin = await request(server).post("/api/v1/admin/login").send({ email: adminEmail, password: adminPassword }).expect(201);
    const adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];

    const walletA = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: loginA.body.ove_account_id } });
    await request(server)
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId: walletA.id, amount: 1000, reason: "me API テスト" })
      .expect(201);

    const txnsA = await request(server).get("/api/v1/me/transactions").set("Cookie", cookieA).expect(200);
    const transactionId = txnsA.body[0].id;

    await request(server).get(`/api/v1/me/transactions/${transactionId}`).set("Cookie", cookieA).expect(200);
    // Bのセッションで、Aの取引IDを直接指定しても404 (本人の取引だけが検索対象)
    await request(server).get(`/api/v1/me/transactions/${transactionId}`).set("Cookie", cookieB).expect(404);
  });

  describe("/api/v1/service/accounts/:externalUserId/balance", () => {
    let serviceA: TestServiceIntegration;
    let serviceB: TestServiceIntegration;

    beforeAll(async () => {
      serviceA = await createTestServiceIntegration("SENGOKU_PASSPORT");
      serviceB = await createTestServiceIntegration("AIART");
    });

    it("自サービスに紐づく external_user_id の残高だけを照会できる", async () => {
      const server = app.getHttpServer();
      const externalUserId = `svc-user-${generateId()}`;

      // rewards/grant を叩いてアカウント・連携を自動作成する
      const grantBody = {
        service_code: "SENGOKU_PASSPORT",
        external_user_id: externalUserId,
        event_type: "REGISTRATION",
        event_id: `EVT-${generateId()}`,
        amount: 3000,
        transaction_type: "REGISTRATION_BONUS",
        display_name: "登録特典",
        idempotency_key: `REG:${generateId()}`,
      };
      await request(server)
        .post("/api/v1/rewards/grant")
        .set(signedHeaders(serviceA, "POST", "/api/v1/rewards/grant", grantBody))
        .send(grantBody)
        .expect(201);

      const balancePath = `/api/v1/service/accounts/${externalUserId}/balance`;
      const res = await request(server)
        .get(balancePath)
        .set(signedHeaders(serviceA, "GET", balancePath, {}))
        .expect(200);
      expect(res.body.available_balance).toBe("3000");
    });

    it("他サービスの external_user_id は自サービスからは見えない (404)", async () => {
      const server = app.getHttpServer();
      const externalUserId = `svc-user-${generateId()}`;

      const grantBody = {
        service_code: "SENGOKU_PASSPORT",
        external_user_id: externalUserId,
        event_type: "REGISTRATION",
        event_id: `EVT-${generateId()}`,
        amount: 3000,
        transaction_type: "REGISTRATION_BONUS",
        display_name: "登録特典",
        idempotency_key: `REG:${generateId()}`,
      };
      await request(server)
        .post("/api/v1/rewards/grant")
        .set(signedHeaders(serviceA, "POST", "/api/v1/rewards/grant", grantBody))
        .send(grantBody)
        .expect(201);

      // serviceA に連携済みの external_user_id を、serviceB のAPIキーで照会 -> 404
      const balancePath = `/api/v1/service/accounts/${externalUserId}/balance`;
      await request(server)
        .get(balancePath)
        .set(signedHeaders(serviceB, "GET", balancePath, {}))
        .expect(404);
    });

    it("HMAC署名がなければ401になる", async () => {
      await request(app.getHttpServer()).get(`/api/v1/service/accounts/unknown-user/balance`).expect(401);
    });
  });
});
