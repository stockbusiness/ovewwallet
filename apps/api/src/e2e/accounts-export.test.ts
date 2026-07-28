import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/** アカウント一覧CSVエクスポート (docs/admin-operations.md参照)。 */
describe("GET /api/v1/admin/accounts/export", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-accounts-export-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Accounts Export Admin",
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

  it("CSVヘッダー・UTF-8 BOM・アカウントの内容を含むCSVを返す", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: login.body.ove_account_id } });

    const res = await request(server).get("/api/v1/admin/accounts/export").set("Cookie", adminCookie).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("accounts.csv");

    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("アカウントコード,状態,表示名,メールアドレス,登録日時,ウォレットコード,利用可能残高");
    expect(lines.some((line) => line.includes(account.accountCode))).toBe(true);
  });

  it("statusで絞り込める", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: login.body.ove_account_id } });

    const res = await request(server)
      .get("/api/v1/admin/accounts/export?status=ACTIVE")
      .set("Cookie", adminCookie)
      .expect(200);
    const lines = res.text.slice(1).trim().split("\r\n").slice(1);
    expect(lines.some((line) => line.includes(account.accountCode))).toBe(true);
    for (const line of lines) {
      expect(line.split(",")[1]).toBe("ACTIVE");
    }
  });
});
