import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { creditWallet } from "@ove/ledger";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 失効予告レポート (GET /api/v1/admin/expire-credits/preview、docs/credit-expiry.md参照)。 */
describe("失効予告レポート (GET /api/v1/admin/expire-credits/preview)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-expiry-preview-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Expiry Preview Admin",
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

  it("バッチを書き換えずに、期限切れロットの影響範囲を返す", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: userLogin.body.ove_account_id } });

    const pastDue = new Date(Date.now() - DAY_MS);
    await creditWallet({
      walletId: wallet.id,
      amount: 4000,
      transactionType: "CAMPAIGN_REWARD",
      idempotencyKey: generateId(),
      displayName: "e2e preview target",
      createdByType: "ADMIN",
      expiresAt: pastDue,
    });

    const res = await request(server)
      .get("/api/v1/admin/expire-credits/preview")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(res.body.wallets_affected).toBeGreaterThanOrEqual(1);
    expect(Number(res.body.total_amount)).toBeGreaterThanOrEqual(4000);

    // プレビューは書き込みを行わないため、ロットは失効させられていないままのはず。
    const lot = await prisma.oveCreditLot.findFirst({ where: { walletId: wallet.id } });
    expect(lot?.expiredAt).toBeNull();
    expect(lot?.remainingAmount).toBe(4000n);

    // 期限切れのまま残すと、他のテストスイート(packages/ledgerのexpiry.test.ts等、
    // 同じテストDBに対してexpireDueCreditLotsをwalletIdで絞らずに全件走査する)の
    // 前提を壊してしまうため、後始末として無効化しておく。
    await prisma.oveCreditLot.updateMany({ where: { walletId: wallet.id }, data: { voidedAt: new Date() } });
  });
});
