import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret, encryptSecret, generateOpaqueToken } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const ENDPOINT = "/api/integrations/agencies/point-awards";
const EVENT_TYPE = "orly.point_award.wallet_delivery";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";

/**
 * 代理店システムからのORI付与イベント受信 (`docs/integration/AGENCY_POINT_AWARD.md`)。
 * 「二重付与しない」「付与先を取り違えない」の2点が、間違えると残高が壊れる箇所なので
 * 重点的に確認する。
 */
describe("代理店システムからのORI付与イベント (orly.point_award.wallet_delivery)", () => {
  let app: INestApplication;
  let partnerApiKey: string;
  let serviceIntegrationId: string;

  beforeAll(async () => {
    process.env.ENABLE_AGENCY_POINT_AWARD_INBOX = "true";

    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    partnerApiKey = `oveagn_test_${generateId()}`;
    const integration = await prisma.serviceIntegration.upsert({
      where: { serviceCode: "AGENCY_SYSTEM" },
      update: { apiKeyHash: hashSecret(partnerApiKey), status: "ACTIVE" },
      create: {
        id: generateId(),
        serviceCode: "AGENCY_SYSTEM",
        serviceName: "test",
        apiKeyHash: hashSecret(partnerApiKey),
        signingSecretEncrypted: encryptSecret(generateOpaqueToken(32), ENCRYPTION_KEY),
        allowedIps: [],
        dailyAmountLimit: 0,
        perRequestAmountLimit: 0,
      },
    });
    serviceIntegrationId = integration.id;
  });

  afterAll(async () => {
    delete process.env.ENABLE_AGENCY_POINT_AWARD_INBOX;
    await app.close();
    await prisma.$disconnect();
  });

  async function createAccountWithWallet(commonUserId?: string): Promise<{
    accountId: string;
    walletId: string;
  }> {
    const accountId = generateId();
    await prisma.oveAccount.create({
      data: {
        id: accountId,
        accountCode: `OVE-ACC-TEST-${generateId()}`,
        status: "ACTIVE",
        ...(commonUserId ? { commonUserId } : {}),
      },
    });
    const walletId = generateId();
    await prisma.wallet.create({
      data: {
        id: walletId,
        oveAccountId: accountId,
        walletCode: `OVE-WLT-TEST-${generateId()}`,
        status: "ACTIVE",
      },
    });
    return { accountId, walletId };
  }

  function baseBody(pointAward: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    const eventId = `orly_wallet_${generateId()}`;
    return {
      event: EVENT_TYPE,
      event_type: EVENT_TYPE,
      event_version: "1.0",
      event_id: eventId,
      source_system_key: "agency-system",
      source: "sengoku-agency-system",
      correlation_id: eventId,
      occurred_at: new Date().toISOString(),
      point_award: {
        award_event_key: `orly_${generateId()}`,
        point_code: "orly",
        points: 3000,
        recipient_type: "direct_referrer",
        trigger_event_type: "referral.confirmed",
        status: "processing",
        ...pointAward,
      },
      ...overrides,
    };
  }

  function post(body: object) {
    return request(app.getHttpServer()).post(ENDPOINT).set("x-api-key", partnerApiKey).send(body);
  }

  async function availableBalance(walletId: string): Promise<bigint> {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    return wallet.availableBalance;
  }

  describe("認証 (5章)", () => {
    it("rejects requests without an API key", async () => {
      const commonUserId = `cu_${generateId()}`;
      await createAccountWithWallet(commonUserId);
      await request(app.getHttpServer())
        .post(ENDPOINT)
        .send(baseBody({ recipient_common_user_id: commonUserId }))
        .expect(401);
    });

    it("accepts Authorization: Bearer as well as x-api-key", async () => {
      const commonUserId = `cu_${generateId()}`;
      const { walletId } = await createAccountWithWallet(commonUserId);

      const res = await request(app.getHttpServer())
        .post(ENDPOINT)
        .set("Authorization", `Bearer ${partnerApiKey}`)
        .send(baseBody({ recipient_common_user_id: commonUserId, points: 1200 }))
        .expect(201);

      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe("credited");
      expect(await availableBalance(walletId)).toBe(1200n);
    });
  });

  describe("Feature Flag", () => {
    it("returns 503 and records nothing while the flag is off", async () => {
      const commonUserId = `cu_${generateId()}`;
      await createAccountWithWallet(commonUserId);
      const body = baseBody({ recipient_common_user_id: commonUserId });

      process.env.ENABLE_AGENCY_POINT_AWARD_INBOX = "false";
      try {
        await post(body).expect(503);
      } finally {
        process.env.ENABLE_AGENCY_POINT_AWARD_INBOX = "true";
      }

      // Flagで止めた分は inbound_events に残さない。残すと、あとでONにしても
      // 同じevent_idが「処理済み」として二度と処理されなくなる。
      const row = await prisma.inboundEvent.findFirst({ where: { eventId: body.event_id } });
      expect(row).toBeNull();
    });
  });

  describe("付与 (4章)", () => {
    it("credits the recipient resolved by recipient_common_user_id", async () => {
      const commonUserId = `cu_${generateId()}`;
      const { accountId, walletId } = await createAccountWithWallet(commonUserId);

      const res = await post(baseBody({ recipient_common_user_id: commonUserId, points: 3000 })).expect(201);

      expect(res.body).toMatchObject({ ok: true, status: "credited", cached: false });
      expect(typeof res.body.wallet_event_id).toBe("string");
      expect(await availableBalance(walletId)).toBe(3000n);

      const transaction = await prisma.oveTransaction.findUniqueOrThrow({
        where: { id: res.body.wallet_event_id },
      });
      expect(transaction.walletId).toBe(walletId);
      expect(transaction.direction).toBe("CREDIT");
      expect(transaction.amount).toBe(3000n);

      const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.commonUserId).toBe(commonUserId);
    });

    it("credits the recipient resolved by recipient_agent_id via account_links", async () => {
      const { accountId, walletId } = await createAccountWithWallet();
      const agentId = String(Math.floor(Math.random() * 1_000_000) + 1);
      await prisma.accountLink.create({
        data: {
          id: generateId(),
          oveAccountId: accountId,
          serviceIntegrationId,
          externalUserId: agentId,
          status: "ACTIVE",
          linkMethod: "AGENCY_SSO",
        },
      });

      // 数値で送られてきても文字列のexternal_user_idと突き合わせられること。
      await post(baseBody({ recipient_agent_id: Number(agentId), points: 500 })).expect(201);

      expect(await availableBalance(walletId)).toBe(500n);
    });

    it("does not credit when the agent has no linked ORI account (404, retryable)", async () => {
      const agentId = `unlinked-${generateId()}`;
      await prisma.accountLink.create({
        data: {
          id: generateId(),
          serviceIntegrationId,
          externalUserId: agentId,
          status: "ACTIVE",
          linkMethod: "AGENCY_SYNC",
        },
      });

      await post(baseBody({ recipient_agent_id: agentId })).expect(404);
    });

    it("does not credit through a revoked account_link", async () => {
      const { accountId, walletId } = await createAccountWithWallet();
      const agentId = `revoked-${generateId()}`;
      await prisma.accountLink.create({
        data: {
          id: generateId(),
          oveAccountId: accountId,
          serviceIntegrationId,
          externalUserId: agentId,
          status: "REVOKED",
          linkMethod: "AGENCY_SSO",
        },
      });

      await post(baseBody({ recipient_agent_id: agentId })).expect(404);

      expect(await availableBalance(walletId)).toBe(0n);
    });

    it("rejects a payload with neither recipient identifier", async () => {
      await post(baseBody({})).expect(400);
    });

    it("rejects non-positive and fractional points without rounding", async () => {
      const commonUserId = `cu_${generateId()}`;
      const { walletId } = await createAccountWithWallet(commonUserId);

      await post(baseBody({ recipient_common_user_id: commonUserId, points: 0 })).expect(400);
      await post(baseBody({ recipient_common_user_id: commonUserId, points: -100 })).expect(400);
      await post(baseBody({ recipient_common_user_id: commonUserId, points: 10.5 })).expect(400);

      expect(await availableBalance(walletId)).toBe(0n);
    });

    it("rejects a point_code this wallet does not issue", async () => {
      const commonUserId = `cu_${generateId()}`;
      const { walletId } = await createAccountWithWallet(commonUserId);

      await post(
        baseBody({ recipient_common_user_id: commonUserId, point_code: "some-other-coin" }),
      ).expect(400);

      expect(await availableBalance(walletId)).toBe(0n);
    });

    it("rejects an event_type this endpoint does not handle", async () => {
      const commonUserId = `cu_${generateId()}`;
      await createAccountWithWallet(commonUserId);
      await post(
        baseBody({ recipient_common_user_id: commonUserId }, { event_type: "reward.granted" }),
      ).expect(400);
    });
  });

  describe("冪等性 (6章)", () => {
    it("returns the same wallet_event_id and credits once when the same event_id is resent", async () => {
      const commonUserId = `cu_${generateId()}`;
      const { walletId } = await createAccountWithWallet(commonUserId);
      const body = baseBody({ recipient_common_user_id: commonUserId, points: 3000 });

      const first = await post(body).expect(201);
      const second = await post(body).expect(201);

      expect(first.body.cached).toBe(false);
      expect(second.body.cached).toBe(true);
      expect(second.body.wallet_event_id).toBe(first.body.wallet_event_id);
      expect(second.body.status).toBe("credited");
      expect(await availableBalance(walletId)).toBe(3000n);
    });

    it("credits once when the same award_event_key arrives under a new event_id", async () => {
      const commonUserId = `cu_${generateId()}`;
      const { walletId } = await createAccountWithWallet(commonUserId);
      const awardEventKey = `orly_${generateId()}`;

      const first = await post(
        baseBody({ recipient_common_user_id: commonUserId, award_event_key: awardEventKey, points: 3000 }),
      ).expect(201);
      // event_idだけ振り直した再送 (送信側がリトライを新規イベントとして起こした場合)。
      const second = await post(
        baseBody({ recipient_common_user_id: commonUserId, award_event_key: awardEventKey, points: 3000 }),
      ).expect(201);

      expect(second.body.wallet_event_id).toBe(first.body.wallet_event_id);
      expect(await availableBalance(walletId)).toBe(3000n);

      const credits = await prisma.oveTransaction.count({
        where: { walletId, transactionType: "COMMON_EVENT_REWARD" },
      });
      expect(credits).toBe(1);
    });

    it("rejects the same event_id carrying a different body (409)", async () => {
      const commonUserId = `cu_${generateId()}`;
      const { walletId } = await createAccountWithWallet(commonUserId);
      const body = baseBody({ recipient_common_user_id: commonUserId, points: 3000 });

      await post(body).expect(201);
      await post({ ...body, point_award: { ...body.point_award, points: 9999 } }).expect(409);

      expect(await availableBalance(walletId)).toBe(3000n);
    });

    it("rejects an Idempotency-Key that disagrees with event_id", async () => {
      const commonUserId = `cu_${generateId()}`;
      await createAccountWithWallet(commonUserId);
      await request(app.getHttpServer())
        .post(ENDPOINT)
        .set("x-api-key", partnerApiKey)
        .set("Idempotency-Key", "something-else")
        .send(baseBody({ recipient_common_user_id: commonUserId }))
        .expect(400);
    });
  });
});
