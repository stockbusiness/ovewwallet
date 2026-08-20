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
import { AgencyReferralAdapter } from "../integrations/agency-referral.adapter";
import { IntegrationHttpClient } from "../integrations/integration-http-client";
import { IntegrationConfigProvider } from "../integrations/integration-config-provider";
import { AccountRepository } from "../accounts/account.repository";

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
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
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
    // PR-W1: このテストは旧特典(3,000 OVE)の確定/自己修復を検証するため明示的にONにする。
    process.env.ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS = "true";
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
      new AgencyReferralClient(new AgencyReferralAdapter(new IntegrationHttpClient(), new IntegrationConfigProvider(prisma))),
      new RejectReferralUseCase(referrals),
      new AccountRepository(prisma),
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

  it("モジュール化後レビュー対応 P1-5回帰: 旧実装由来のCREDIT既存+PENDING状態を、二重付与せず自己修復する", async () => {
    process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
    // PR-W1: このテストは旧特典(3,000 OVE)の確定/自己修復を検証するため明示的にONにする。
    process.env.ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS = "true";
    const server = app.getHttpServer();

    const referralToken = `referral-selfheal-${generateId()}`;
    const captureRes = await request(server).get(`/api/v1/referrals/capture?token=${referralToken}`).expect(302);
    const referralCookieValue = (captureRes.headers["set-cookie"] as unknown as string[])
      ?.find((c) => c.startsWith(`${REFERRAL_SESSION_COOKIE_NAME}=`))
      ?.match(new RegExp(`${REFERRAL_SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
    expect(referralCookieValue).toBeDefined();

    const lineUserId = `e2e-referral-selfheal-${generateId()}`;
    const login = await request(server)
      .post("/api/v1/auth/line/login")
      .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${referralCookieValue}`])
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(201);
    const oveAccountId = login.body.ove_account_id as string;

    const benefit = await prisma.walletReferralBenefit.findUniqueOrThrow({
      where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
    });
    expect(benefit.status).toBe("PENDING");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });

    // Phase 3の原子化以前の旧実装由来を模した不整合データ: CREDIT取引は既に存在するが
    // (残高にも反映済み)、benefit/referralはPENDINGのまま。他の全フィールドは
    // creditWalletInTransactionが実際に設定するものと完全一致させる (完全一致時のみ
    // 自己修復することの回帰テストであるため)。
    const legacyIdempotencyKey = `REFERRAL_SIGNUP_BONUS_CONFIRMED:${benefit.id}`;
    const referral = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    await prisma.oveTransaction.create({
      data: {
        id: generateId(),
        walletId: wallet.id,
        transactionCode: `OVE-TXN-LEGACY-${generateId()}`,
        transactionType: "REFERRAL_REWARD",
        direction: "CREDIT",
        amount: benefit.amount,
        status: "COMPLETED",
        balanceBefore: wallet.availableBalance,
        balanceAfter: wallet.availableBalance + benefit.amount,
        displayName: "代理店紹介登録特典 (legacy)",
        sourceService: "AGENCY_SYSTEM",
        sourceReferenceId: referral.id,
        idempotencyKey: legacyIdempotencyKey,
        completedAt: new Date(),
        createdByType: "EXTERNAL_SERVICE",
        metadata: { referralId: referral.id, benefitId: benefit.id, eventId: "legacy-event" },
      },
    });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { increment: benefit.amount }, lifetimeCredited: { increment: benefit.amount } },
    });
    const walletBeforeConfirm = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

    const referrals = new ReferralRepository(prisma);
    const confirm = new ConfirmReferralUseCase(
      prisma,
      referrals,
      new AgencyReferralClient(new AgencyReferralAdapter(new IntegrationHttpClient(), new IntegrationConfigProvider(prisma))),
      new RejectReferralUseCase(referrals),
      new AccountRepository(prisma),
    );

    const result = await confirm.confirmBenefitFromEvent({ walletUserId: oveAccountId, eventId: `selfheal-${generateId()}` });
    expect(result.action).toBe("confirmed");
    expect(result.transaction_id).toBeTruthy();

    const benefitAfter = await prisma.walletReferralBenefit.findUniqueOrThrow({ where: { id: benefit.id } });
    expect(benefitAfter.status).toBe("CONFIRMED");
    expect(benefitAfter.ledgerTransactionId).toBe(result.transaction_id);

    const referralAfter = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    expect(referralAfter.status).toBe("CONFIRMED");

    // 残高は二重加算されていない (既存のlegacy CREDITの分だけで変化なし)。
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletAfter.availableBalance.toString()).toBe(walletBeforeConfirm.availableBalance.toString());

    const creditCount = await prisma.oveTransaction.count({ where: { idempotencyKey: legacyIdempotencyKey } });
    expect(creditCount).toBe(1);
  });

  /**
   * 追加整合性対策 P1-1: 自己修復照合の強化回帰。既存取引が1項目でも想定と異なれば
   * 自動修復せず`existing_transaction_mismatch_requires_review`として扱い、
   * 残高・状態を変更せず、監査ログ(REFERRAL_SELF_HEAL_MISMATCH)を残すことを検証する。
   */
  describe.each([
    ["walletId不一致", (data: LegacyTxOverrides, otherWalletId: string) => ({ ...data, walletId: otherWalletId })],
    ["amount不一致", (data: LegacyTxOverrides) => ({ ...data, amount: data.amount + 1 })],
    ["transactionType不一致", (data: LegacyTxOverrides) => ({ ...data, transactionType: "ADMIN_GRANT" as const })],
    ["direction不一致", (data: LegacyTxOverrides) => ({ ...data, direction: "DEBIT" as const })],
    ["status不一致", (data: LegacyTxOverrides) => ({ ...data, status: "PENDING" as const })],
    ["sourceService不一致", (data: LegacyTxOverrides) => ({ ...data, sourceService: "SHOPPING_SYSTEM" })],
    ["sourceReferenceId不一致", (data: LegacyTxOverrides) => ({ ...data, sourceReferenceId: "wrong-referral-id" })],
  ] as const)("旧紹介データ自己修復の照合強化 (追加整合性対策 P1-1回帰): %s", (_label, mutate) => {
    it("自動修復せず要レビューとして扱い、残高・状態を変更せず監査ログを残す", async () => {
      process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
      const server = app.getHttpServer();

      const referralToken = `referral-mismatch-${generateId()}`;
      const captureRes = await request(server).get(`/api/v1/referrals/capture?token=${referralToken}`).expect(302);
      const referralCookieValue = (captureRes.headers["set-cookie"] as unknown as string[])
        ?.find((c) => c.startsWith(`${REFERRAL_SESSION_COOKIE_NAME}=`))
        ?.match(new RegExp(`${REFERRAL_SESSION_COOKIE_NAME}=([^;]+)`))?.[1];

      const lineUserId = `e2e-referral-mismatch-${generateId()}`;
      const login = await request(server)
        .post("/api/v1/auth/line/login")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${referralCookieValue}`])
        .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
        .expect(201);
      const oveAccountId = login.body.ove_account_id as string;

      const benefit = await prisma.walletReferralBenefit.findUniqueOrThrow({
        where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
      });
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
      const referral = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });

      // walletId不一致ケース用に、実在する別のwalletを用意する (oveTransaction.walletIdは
      // 外部キーのため、実在しないIDでは行自体を作成できない)。
      const otherLogin = await request(server)
        .post("/api/v1/auth/line/login")
        .send({ idToken: `mock.other-${generateId()}`, termsAccepted: true })
        .expect(201);
      const otherWallet = await prisma.wallet.findUniqueOrThrow({
        where: { oveAccountId: otherLogin.body.ove_account_id as string },
      });

      const baseData: LegacyTxOverrides = {
        walletId: wallet.id,
        amount: Number(benefit.amount),
        transactionType: "REFERRAL_REWARD",
        direction: "CREDIT",
        status: "COMPLETED",
        sourceService: "AGENCY_SYSTEM",
        sourceReferenceId: referral.id,
      };
      const mutated = mutate(baseData, otherWallet.id);
      const idempotencyKey = `REFERRAL_SIGNUP_BONUS_CONFIRMED:${benefit.id}`;

      await prisma.oveTransaction.create({
        data: {
          id: generateId(),
          walletId: mutated.walletId,
          transactionCode: `OVE-TXN-MISMATCH-${generateId()}`,
          transactionType: mutated.transactionType,
          direction: mutated.direction,
          amount: mutated.amount,
          status: mutated.status,
          balanceBefore: wallet.availableBalance,
          balanceAfter: wallet.availableBalance + BigInt(mutated.amount),
          displayName: "代理店紹介登録特典 (mismatch fixture)",
          sourceService: mutated.sourceService,
          sourceReferenceId: mutated.sourceReferenceId,
          idempotencyKey,
          completedAt: new Date(),
          createdByType: "EXTERNAL_SERVICE",
          metadata: { referralId: referral.id, benefitId: benefit.id, eventId: "mismatch-fixture" },
        },
      });
      const walletBeforeConfirm = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

      const referrals = new ReferralRepository(prisma);
      const confirm = new ConfirmReferralUseCase(
        prisma,
        referrals,
        new AgencyReferralClient(new AgencyReferralAdapter(new IntegrationHttpClient(), new IntegrationConfigProvider(prisma))),
        new RejectReferralUseCase(referrals),
        new AccountRepository(prisma),
      );

      const result = await confirm.confirmBenefitFromEvent({ walletUserId: oveAccountId, eventId: `mismatch-${generateId()}` });
      expect(result.action).toBe("existing_transaction_mismatch_requires_review");

      const benefitAfter = await prisma.walletReferralBenefit.findUniqueOrThrow({ where: { id: benefit.id } });
      expect(benefitAfter.status).toBe("PENDING");

      const referralAfter = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
      expect(referralAfter.status).toBe("PENDING");

      // walletIdが不一致のケースでは対象walletそのものが変わっていないため、
      // このウォレットの残高は元々の(不整合fixture作成前の)値のまま。
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBalance.toString()).toBe(walletBeforeConfirm.availableBalance.toString());

      const mismatchLogs = await prisma.auditLog.findMany({
        where: { targetType: "wallet_referral", targetId: referral.id, actionType: "REFERRAL_SELF_HEAL_MISMATCH" },
      });
      expect(mismatchLogs).toHaveLength(1);
    });
  });
});

interface LegacyTxOverrides {
  walletId: string;
  amount: number;
  transactionType: "REFERRAL_REWARD" | "ADMIN_GRANT";
  direction: "CREDIT" | "DEBIT";
  status: "COMPLETED" | "PENDING";
  sourceService: string;
  sourceReferenceId: string;
}
