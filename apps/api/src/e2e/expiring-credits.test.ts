import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ウォレットホーム画面の失効警告バナー向け GET /api/v1/me/wallet/expiring-credits。 */
describe("失効間近OVEの警告 (GET /api/v1/me/wallet/expiring-credits)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("30日以内に失効予定のロットのみ合計し、最短の失効日を返す", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const userCookie = userLogin.headers["set-cookie"] as unknown as string[];
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: userLogin.body.ove_account_id } });

    const soon = new Date(Date.now() + 5 * DAY_MS);
    const later = new Date(Date.now() + 10 * DAY_MS);
    const farFuture = new Date(Date.now() + 90 * DAY_MS);

    await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "CAMPAIGN_REWARD",
      idempotencyKey: generateId(),
      displayName: "e2e campaign 1",
      createdByType: "ADMIN",
      expiresAt: soon,
    });
    await creditWallet({
      walletId: wallet.id,
      amount: 2000,
      transactionType: "CAMPAIGN_REWARD",
      idempotencyKey: generateId(),
      displayName: "e2e campaign 2",
      createdByType: "ADMIN",
      expiresAt: later,
    });
    await creditWallet({
      walletId: wallet.id,
      amount: 5000,
      transactionType: "CAMPAIGN_REWARD",
      idempotencyKey: generateId(),
      displayName: "e2e campaign far future",
      createdByType: "ADMIN",
      expiresAt: farFuture,
    });

    const res = await request(server).get("/api/v1/me/wallet/expiring-credits").set("Cookie", userCookie).expect(200);
    expect(res.body.within_days).toBe(30);
    expect(res.body.total_amount).toBe("3000");
    expect(new Date(res.body.nearest_expires_at).toISOString().slice(0, 10)).toBe(soon.toISOString().slice(0, 10));
  });

  it("失効予定のロットが無ければ合計0・nearest_expires_atはnullを返す", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const userCookie = userLogin.headers["set-cookie"] as unknown as string[];

    const res = await request(server).get("/api/v1/me/wallet/expiring-credits").set("Cookie", userCookie).expect(200);
    expect(res.body).toEqual({ within_days: 30, total_amount: "0", nearest_expires_at: null });
  });
});
