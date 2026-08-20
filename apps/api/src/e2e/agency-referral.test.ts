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
 * 代理店紹介トークン受け入れ (実装指示書 v1.0) Phase 1: /invite/{token} 相当の
 * 受付 (`GET /api/v1/referrals/capture`) から、LINEログイン後の新規登録時の
 * 紐付け・初回登録特典(PENDING)・outbox登録までを検証する。実際の代理店システムへの
 * 送信(Phase 2)は対象外。
 */
describe("agency referral token acceptance (実装指示書 v1.0, Phase 1)", () => {
  let app: INestApplication;

  function extractCookie(setCookieHeader: string[] | undefined, name: string): string | undefined {
    const raw = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
    if (!raw) return undefined;
    const match = raw.match(new RegExp(`${name}=([^;]+)`));
    return match?.[1];
  }

  async function captureReferral(
    token: string,
  ): Promise<{ cookieValue?: string; location?: string; referralId?: string }> {
    const res = await request(app.getHttpServer()).get(`/api/v1/referrals/capture?token=${token}`).expect(302);
    const cookieValue = extractCookie(res.headers["set-cookie"] as unknown as string[], REFERRAL_SESSION_COOKIE_NAME);
    const referral = cookieValue
      ? await prisma.walletReferral.findFirst({ orderBy: { createdAt: "desc" } })
      : undefined;
    return { cookieValue, location: res.headers.location, referralId: referral?.id };
  }

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

  describe("GET /api/v1/referrals/capture", () => {
    it("does not persist anything when ENABLE_WALLET_REFERRAL_TOKEN is disabled", async () => {
      process.env.ENABLE_WALLET_REFERRAL_TOKEN = "false";
      const before = await prisma.walletReferral.count();
      const token = `referral-disabled-${generateId()}`;
      const { cookieValue, location } = await captureReferral(token);
      const after = await prisma.walletReferral.count();

      expect(cookieValue).toBeUndefined();
      expect(location).toContain("/login");
      expect(after).toBe(before);
    });

    it("persists a CAPTURED referral and issues a cookie when enabled", async () => {
      process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
      const token = `referral-token-${generateId()}`;
      const { cookieValue, location } = await captureReferral(token);

      expect(cookieValue).toBeDefined();
      expect(location).toContain("/login");

      const referrals = await prisma.walletReferral.findMany({ orderBy: { createdAt: "desc" }, take: 1 });
      expect(referrals[0]!.status).toBe("CAPTURED");
      expect(referrals[0]!.walletUserId).toBeNull();
    });

    it("does not persist anything for a malformed token", async () => {
      process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
      const before = await prisma.walletReferral.count();
      // 許可文字集合外 (空白) を含む不正な形式。
      const { cookieValue } = await captureReferral("invalid token with spaces");
      const after = await prisma.walletReferral.count();

      expect(cookieValue).toBeUndefined();
      expect(after).toBe(before);
    });
  });

  describe("POST /api/v1/auth/line/login と紐付け", () => {
    beforeEach(() => {
      process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
      // PR-W1: このdescribe内の既存テストは旧特典が作成される前提のため、明示的にONにする。
      process.env.ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS = "true";
    });

    it("links the referral, creates a PENDING benefit, and enqueues an outbox event on new registration", async () => {
      const referralToken = `referral-line-${generateId()}`;
      const { cookieValue } = await captureReferral(referralToken);
      expect(cookieValue).toBeDefined();

      const lineUserId = `e2e-line-${generateId()}`;
      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
        .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
        .expect(201);

      const oveAccountId = loginRes.body.ove_account_id as string;
      expect(oveAccountId).toBeTruthy();

      // 紹介Cookieは使い切りとして削除される。
      const clearedCookie = (loginRes.headers["set-cookie"] as unknown as string[])?.find((c) =>
        c.startsWith(`${REFERRAL_SESSION_COOKIE_NAME}=`),
      );
      expect(clearedCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);

      const referral = await prisma.walletReferral.findFirstOrThrow({
        where: { walletUserId: oveAccountId },
      });
      expect(referral.status).toBe("PENDING");
      expect(referral.usedAt).not.toBeNull();
      expect(referral.registeredAt).not.toBeNull();

      const benefit = await prisma.walletReferralBenefit.findUniqueOrThrow({
        where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
      });
      expect(benefit.status).toBe("PENDING");
      expect(benefit.amount.toString()).toBe("3000");
      expect(benefit.walletUserId).toBe(oveAccountId);

      const outboxEvent = await prisma.integrationOutbox.findUniqueOrThrow({
        where: { idempotencyKey: `WALLET_REFERRAL_REGISTERED:${referral.id}` },
      });
      expect(outboxEvent.destinationService).toBe("AGENCY_SYSTEM");
      expect(outboxEvent.status).toBe("PENDING");
      const payload = outboxEvent.payload as { referral_token: string; wallet_user_id: string };
      expect(payload.wallet_user_id).toBe(oveAccountId);
      expect(payload.referral_token).toBe(referralToken); // outbox送信用に平文へ復号できている

      // 台帳の残高はまだ動かない (Phase 1では確定付与しない)。
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
      expect(wallet.availableBalance.toString()).toBe("0");
    });

    it("PR-W1: links the referral and sends the outbox event, but does NOT create the legacy 3,000 OVE benefit when ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS is unset (default)", async () => {
      delete process.env.ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS;

      const referralToken = `referral-line-legacy-off-${generateId()}`;
      const { cookieValue } = await captureReferral(referralToken);
      expect(cookieValue).toBeDefined();

      const lineUserId = `e2e-line-legacy-off-${generateId()}`;
      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
        .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
        .expect(201);

      const oveAccountId = loginRes.body.ove_account_id as string;
      expect(oveAccountId).toBeTruthy();

      const referral = await prisma.walletReferral.findFirstOrThrow({
        where: { walletUserId: oveAccountId },
      });
      expect(referral.status).toBe("PENDING");

      const benefit = await prisma.walletReferralBenefit.findUnique({
        where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
      });
      expect(benefit).toBeNull();

      const outboxEvent = await prisma.integrationOutbox.findUniqueOrThrow({
        where: { idempotencyKey: `WALLET_REFERRAL_REGISTERED:${referral.id}` },
      });
      expect(outboxEvent.destinationService).toBe("AGENCY_SYSTEM");
    });

    it("PR-W1: does NOT create the legacy 3,000 OVE benefit when ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS=false", async () => {
      process.env.ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS = "false";

      const referralToken = `referral-line-legacy-false-${generateId()}`;
      const { cookieValue } = await captureReferral(referralToken);

      const lineUserId = `e2e-line-legacy-false-${generateId()}`;
      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
        .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
        .expect(201);

      const oveAccountId = loginRes.body.ove_account_id as string;
      const benefit = await prisma.walletReferralBenefit.findUnique({
        where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
      });
      expect(benefit).toBeNull();
    });

    it("does not create any referral record when logging in without a referral cookie", async () => {
      const lineUserId = `e2e-line-noref-${generateId()}`;
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
        .expect(201);

      const oveAccountId = res.body.ove_account_id as string;
      const referral = await prisma.walletReferral.findFirst({ where: { walletUserId: oveAccountId } });
      expect(referral).toBeNull();
    });

    it("does not overwrite an existing user's referral state when they open another referral link", async () => {
      const lineUserId = `e2e-line-existing-${generateId()}`;
      const firstLogin = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
        .expect(201);
      const oveAccountId = firstLogin.body.ove_account_id as string;

      const anotherToken = `referral-existing-user-${generateId()}`;
      const { cookieValue, referralId } = await captureReferral(anotherToken);

      await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
        .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
        .expect(201);

      // 既存ユーザーなので紹介関係は作られない (このユーザーへ紐づく紹介レコードは無い)。
      const referral = await prisma.walletReferral.findFirst({ where: { walletUserId: oveAccountId } });
      expect(referral).toBeNull();

      // 紹介セッション自体もCAPTUREDのまま残り、使用済みにならない。
      const untouchedReferral = await prisma.walletReferral.findUniqueOrThrow({ where: { id: referralId } });
      expect(untouchedReferral.status).toBe("CAPTURED");
      expect(untouchedReferral.usedAt).toBeNull();
    });

    it("does not allow reusing an already-used referral session for a second registration", async () => {
      const referralToken = `referral-reuse-${generateId()}`;
      const { cookieValue } = await captureReferral(referralToken);

      const firstLineUserId = `e2e-line-reuse-1-${generateId()}`;
      await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
        .send({ idToken: `mock.${firstLineUserId}`, termsAccepted: true })
        .expect(201);

      const secondLineUserId = `e2e-line-reuse-2-${generateId()}`;
      const secondRes = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
        .send({ idToken: `mock.${secondLineUserId}`, termsAccepted: true })
        .expect(201);

      const secondAccountId = secondRes.body.ove_account_id as string;
      const referralForSecond = await prisma.walletReferral.findFirst({ where: { walletUserId: secondAccountId } });
      expect(referralForSecond).toBeNull(); // 使用済みセッションでは紐付けが起きない
    });

    it("attaches the referral to exactly one of two concurrent new registrations sharing the same session", async () => {
      const referralToken = `referral-concurrent-${generateId()}`;
      const { cookieValue, referralId } = await captureReferral(referralToken);
      expect(cookieValue).toBeDefined();

      const lineUserIdA = `e2e-line-concurrent-a-${generateId()}`;
      const lineUserIdB = `e2e-line-concurrent-b-${generateId()}`;

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post("/api/v1/auth/line/login")
          .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
          .send({ idToken: `mock.${lineUserIdA}`, termsAccepted: true }),
        request(app.getHttpServer())
          .post("/api/v1/auth/line/login")
          .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
          .send({ idToken: `mock.${lineUserIdB}`, termsAccepted: true }),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      const accountIdA = resA.body.ove_account_id as string;
      const accountIdB = resB.body.ove_account_id as string;

      // どちらも新規登録は成功するが、紹介の紐付けは片方にしか起きない
      // (レースに負けた側は紹介なしの通常登録として扱われる、finding #5の修正)。
      const attachedCount = await prisma.walletReferral.count({
        where: { id: referralId, walletUserId: { in: [accountIdA, accountIdB] } },
      });
      expect(attachedCount).toBe(1);

      const benefitCount = await prisma.walletReferralBenefit.count({
        where: { walletUserId: { in: [accountIdA, accountIdB] } },
      });
      expect(benefitCount).toBe(1); // 特典も二重付与されない
    });
  });
});
