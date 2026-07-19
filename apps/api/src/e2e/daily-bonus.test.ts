import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/** 継続ログイン(デイリー)ボーナス (docs/daily-login-bonus.md参照)。 */
describe("継続ログインボーナス", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("初回請求はstreak=1・10 OVEで、同日2回目の請求は409", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookie = login.headers["set-cookie"] as unknown as string[];

    const statusBefore = await request(server).get("/api/v1/me/daily-bonus/status").set("Cookie", cookie).expect(200);
    expect(statusBefore.body).toEqual({ claimed_today: false, current_streak: 0, next_streak: 1, next_amount: "10" });

    const claim = await request(server).post("/api/v1/me/daily-bonus/claim").set("Cookie", cookie).expect(201);
    expect(claim.body).toEqual({ claimed_today: true, current_streak: 1, amount: "10" });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: login.body.ove_account_id } });
    expect(wallet.availableBalance.toString()).toBe("10");

    await request(server).post("/api/v1/me/daily-bonus/claim").set("Cookie", cookie).expect(409);

    const statusAfter = await request(server).get("/api/v1/me/daily-bonus/status").set("Cookie", cookie).expect(200);
    expect(statusAfter.body).toEqual({ claimed_today: true, current_streak: 1, next_streak: 1, next_amount: "10" });
  });

  it("前日分の記録を手動で作った状態から請求すると streak が積み上がる", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookie = login.headers["set-cookie"] as unknown as string[];
    const oveAccountId = login.body.ove_account_id as string;
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });

    // 3日連続で受け取っていた状態を再現するため、前日分のclaimレコードを直接作成する。
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDateOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    const fakeTxn = await prisma.oveTransaction.create({
      data: {
        id: generateId(),
        walletId: wallet.id,
        transactionCode: `OVE-TXN-FAKE-${generateId()}`,
        transactionType: "DAILY_LOGIN_BONUS",
        direction: "CREDIT",
        amount: 20,
        status: "COMPLETED",
        balanceBefore: 0,
        balanceAfter: 20,
        displayName: "継続ログインボーナス",
        idempotencyKey: `DAILY_LOGIN_BONUS:${oveAccountId}:fake-yesterday`,
        occurredAt: yesterday,
        completedAt: yesterday,
        createdByType: "SYSTEM",
      },
    });
    await prisma.dailyBonusClaim.create({
      data: {
        id: generateId(),
        oveAccountId,
        claimedDate: yesterdayDateOnly,
        streakCount: 3,
        amount: 20,
        transactionId: fakeTxn.id,
      },
    });
    await prisma.wallet.update({ where: { id: wallet.id }, data: { availableBalance: 20 } });

    const status = await request(server).get("/api/v1/me/daily-bonus/status").set("Cookie", cookie).expect(200);
    expect(status.body).toEqual({ claimed_today: false, current_streak: 3, next_streak: 4, next_amount: "20" });

    const claim = await request(server).post("/api/v1/me/daily-bonus/claim").set("Cookie", cookie).expect(201);
    expect(claim.body).toEqual({ claimed_today: true, current_streak: 4, amount: "20" });
  });
});
