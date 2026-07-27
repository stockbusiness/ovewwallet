import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

describe("全セッション無効化 (指示書16章)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-revoke-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Revoke Admin",
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = loginRes.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("revokes every active session and immediately invalidates them for auth", async () => {
    const server = app.getHttpServer();

    // 2つの「端末」からログイン (同一LINEユーザー = 同一アカウント、セッションは別々)。
    const idToken = `mock.${generateId()}`;
    const login1 = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookie1 = login1.headers["set-cookie"] as unknown as string[];
    const accountId: string = login1.body.ove_account_id;

    const login2 = await request(server).post("/api/v1/auth/line/login").send({ idToken }).expect(201);
    const cookie2 = login2.headers["set-cookie"] as unknown as string[];

    // 両方のセッションが有効であることを確認
    await request(server).get("/api/v1/accounts/me").set("Cookie", cookie1).expect(200);
    await request(server).get("/api/v1/accounts/me").set("Cookie", cookie2).expect(200);

    const detailBefore = await request(server)
      .get(`/api/v1/admin/accounts/${accountId}`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(detailBefore.body.activeSessionCount).toBe(2);

    const revokeRes = await request(server)
      .post(`/api/v1/admin/accounts/${accountId}/revoke-sessions`)
      .set("Cookie", adminCookie)
      .send({})
      .expect(201);
    expect(revokeRes.body.revokedCount).toBe(2);

    // 無効化後は両方の端末で即座に使えなくなる
    await request(server).get("/api/v1/accounts/me").set("Cookie", cookie1).expect(401);
    await request(server).get("/api/v1/accounts/me").set("Cookie", cookie2).expect(401);

    const detailAfter = await request(server)
      .get(`/api/v1/admin/accounts/${accountId}`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(detailAfter.body.activeSessionCount).toBe(0);

    // 監査ログに記録されること
    const auditEntry = detailAfter.body.auditLogs.find((l: { actionType: string }) => l.actionType === "ACCOUNT_SESSIONS_REVOKED");
    expect(auditEntry).toBeDefined();
    expect(auditEntry.result).toBe("SUCCESS");
  });

  it("is idempotent: revoking again when there are no active sessions revokes zero", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const accountId: string = login.body.ove_account_id;

    const first = await request(server)
      .post(`/api/v1/admin/accounts/${accountId}/revoke-sessions`)
      .set("Cookie", adminCookie)
      .send({})
      .expect(201);
    expect(first.body.revokedCount).toBe(1);

    const second = await request(server)
      .post(`/api/v1/admin/accounts/${accountId}/revoke-sessions`)
      .set("Cookie", adminCookie)
      .send({})
      .expect(201);
    expect(second.body.revokedCount).toBe(0);
  });

  it("returns 404 for an unknown account", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${generateId()}/revoke-sessions`)
      .set("Cookie", adminCookie)
      .send({})
      .expect(404);
  });

  it("rejects roles without account-management permission", async () => {
    const server = app.getHttpServer();
    const email = `e2e-revoke-auditor-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "AUDITOR",
        displayName: "E2E Revoke Auditor",
      },
    });
    const loginRes = await request(server).post("/api/v1/admin/login").send({ email, password }).expect(201);
    const auditorCookie = loginRes.headers["set-cookie"] as unknown as string[];

    await request(server)
      .post(`/api/v1/admin/accounts/${generateId()}/revoke-sessions`)
      .set("Cookie", auditorCookie)
      .send({})
      .expect(403);
  });
});
