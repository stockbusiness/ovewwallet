import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/** 自分の取引履歴CSVエクスポート (docs/transaction-export.md参照)。 */
describe("GET /api/v1/me/transactions/export", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-export-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Export Admin",
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("CSVヘッダー・自分の取引のみを含むCSVを返す", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookie = login.headers["set-cookie"] as unknown as string[];
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: login.body.ove_account_id } });

    await request(server)
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId: wallet.id, amount: 1234, reason: "e2e export test grant" })
      .expect(201);

    const res = await request(server).get("/api/v1/me/transactions/export").set("Cookie", cookie).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("transactions.csv");

    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("取引コード,日時,種別,方向,金額,状態,取引後残高,内容");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("1234");
    expect(lines[1]).toContain("獲得");
  });

  it("他人の取引は含まれない", async () => {
    const server = app.getHttpServer();

    const idTokenA = `mock.${generateId()}`;
    const loginA = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenA, termsAccepted: true }).expect(201);
    const cookieA = loginA.headers["set-cookie"] as unknown as string[];
    const walletA = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: loginA.body.ove_account_id } });

    const idTokenB = `mock.${generateId()}`;
    const loginB = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenB, termsAccepted: true }).expect(201);
    const cookieB = loginB.headers["set-cookie"] as unknown as string[];

    await request(server)
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId: walletA.id, amount: 555, reason: "for A only" })
      .expect(201);

    const resB = await request(server).get("/api/v1/me/transactions/export").set("Cookie", cookieB).expect(200);
    expect(resB.text).not.toContain("555");
  });
});
