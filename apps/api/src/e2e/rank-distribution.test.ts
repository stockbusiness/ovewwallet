import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/** ダッシュボード向け会員ランク分布 (GET /api/v1/admin/dashboard-stats/rank-distribution)。 */
describe("会員ランク分布 (GET /api/v1/admin/dashboard-stats/rank-distribution)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-rank-dist-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Rank Distribution Admin",
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

  it("階級ごとの人数を返し、6,000 OVE付与後のウォレットは「侍」に計上される", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: userLogin.body.ove_account_id } });

    await request(server)
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId: wallet.id, amount: 6000, reason: "e2e rank distribution" })
      .expect(201);

    const res = await request(server)
      .get("/api/v1/admin/dashboard-stats/rank-distribution")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(res.body).toEqual([
      { name: "足軽", count: expect.any(Number) },
      { name: "侍", count: expect.any(Number) },
      { name: "武将", count: expect.any(Number) },
      { name: "大名", count: expect.any(Number) },
      { name: "天下人", count: expect.any(Number) },
    ]);
    const samuraiEntry = res.body.find((r: { name: string }) => r.name === "侍");
    expect(samuraiEntry.count).toBeGreaterThanOrEqual(1);

    const totalCount = res.body.reduce((sum: number, r: { count: number }) => sum + r.count, 0);
    const totalWallets = await prisma.wallet.count();
    expect(totalCount).toBe(totalWallets);
  });
});
