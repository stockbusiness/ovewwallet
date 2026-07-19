import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { REFERRAL_SESSION_COOKIE_NAME } from "../referrals/referrals.controller";

/**
 * GET /api/v1/me/referral-status: 本人の紹介登録特典状況の確認
 * (docs/referral-status.md参照)。
 */
describe("GET /api/v1/me/referral-status", () => {
  let app: INestApplication;

  function extractCookie(setCookieHeader: string[] | undefined, name: string): string | undefined {
    const raw = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
    if (!raw) return undefined;
    const match = raw.match(new RegExp(`${name}=([^;]+)`));
    return match?.[1];
  }

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

  it("紹介登録でないユーザーには referred: false のみを返す", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookie = login.headers["set-cookie"] as unknown as string[];

    const res = await request(server).get("/api/v1/me/referral-status").set("Cookie", cookie).expect(200);
    expect(res.body).toEqual({ referred: false });
  });

  it("紹介登録済みユーザーには PENDING の特典状況を返す", async () => {
    process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
    const server = app.getHttpServer();

    const referralToken = `referral-status-${generateId()}`;
    const captureRes = await request(server).get(`/api/v1/referrals/capture?token=${referralToken}`).expect(302);
    const referralCookieValue = extractCookie(
      captureRes.headers["set-cookie"] as unknown as string[],
      REFERRAL_SESSION_COOKIE_NAME,
    );
    expect(referralCookieValue).toBeDefined();

    const lineUserId = `e2e-referral-status-${generateId()}`;
    const login = await request(server)
      .post("/api/v1/auth/line/login")
      .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${referralCookieValue}`])
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(201);
    const userCookie = login.headers["set-cookie"] as unknown as string[];

    const res = await request(server).get("/api/v1/me/referral-status").set("Cookie", userCookie).expect(200);
    expect(res.body).toMatchObject({ referred: true, status: "PENDING", amount: "3000", confirmed_at: null });
  });
});
