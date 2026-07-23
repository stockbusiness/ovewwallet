import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { REFERRAL_SESSION_COOKIE_NAME } from "../referrals/referrals.controller";
import { ReferralRepository } from "../referrals/referral.repository";
import { ConfirmReferralUseCase } from "../referrals/confirm-referral.use-case";
import { RejectReferralUseCase } from "../referrals/reject-referral.use-case";
import { AgencyReferralClient } from "../referrals/agency-referral-client";

/**
 * リファクタリング指示書 Phase 3 (§9 原子性): 紹介特典確定 (CREDIT・
 * wallet_referral_benefits確定・wallet_referrals確定) が1つのDBトランザクションで
 * 行われることを検証する。同一の紹介関係に対して`confirmBenefitFromEvent`を
 * 同時に2回呼んでも、二重にCREDIT取引が作られない (idempotencyKeyの一意制約と
 * トランザクション内の権威ある状態再確認により、片方は`already_confirmed`または
 * `benefit_not_pending`として無害に終わる) ことを確認する。
 */
describe("紹介特典確定の原子性 (confirmBenefitFromEvent)", () => {
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

  it("同一の紹介関係を並行してconfirmしても、CREDIT取引は1件だけ作られる", async () => {
    process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
    const server = app.getHttpServer();

    const referralToken = `referral-atomic-${generateId()}`;
    const captureRes = await request(server).get(`/api/v1/referrals/capture?token=${referralToken}`).expect(302);
    const referralCookieValue = extractCookie(
      captureRes.headers["set-cookie"] as unknown as string[],
      REFERRAL_SESSION_COOKIE_NAME,
    );
    expect(referralCookieValue).toBeDefined();

    const lineUserId = `e2e-referral-atomic-${generateId()}`;
    const login = await request(server)
      .post("/api/v1/auth/line/login")
      .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${referralCookieValue}`])
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(201);
    const oveAccountId = login.body.ove_account_id as string;

    const referral = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    expect(referral.status).toBe("PENDING");

    const referrals = new ReferralRepository(prisma);
    const confirm = new ConfirmReferralUseCase(
      prisma,
      referrals,
      new AgencyReferralClient(prisma),
      new RejectReferralUseCase(referrals),
    );

    const [resultA, resultB] = await Promise.all([
      confirm.confirmBenefitFromEvent({ walletUserId: oveAccountId, eventId: `race-a-${generateId()}` }),
      confirm.confirmBenefitFromEvent({ walletUserId: oveAccountId, eventId: `race-b-${generateId()}` }),
    ]);

    const actions = [resultA.action, resultB.action].sort();
    // どちらも"confirmed"を主張することはない (どちらか一方だけが実際にCREDITを作る)。
    expect(actions.filter((a) => a === "confirmed")).toHaveLength(1);

    const benefit = await prisma.walletReferralBenefit.findUniqueOrThrow({
      where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
    });
    expect(benefit.status).toBe("CONFIRMED");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    expect(wallet.availableBalance.toString()).toBe("3000"); // 二重加算されていない

    const creditCount = await prisma.oveTransaction.count({
      where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS_CONFIRMED:${benefit.id}` },
    });
    expect(creditCount).toBe(1);

    const referralAfter = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    expect(referralAfter.status).toBe("CONFIRMED");
  });
});
