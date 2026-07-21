import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import {
  createTestCommonEventSigningKey,
  commonEventSignedHeaders,
  type TestCommonEventSigningKey,
} from "./test-helpers";

const ENDPOINT = "/api/integrations/events";

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 6章の共通イベント受信 (Inbox) を検証する。
 * HMAC認証 (6.1章)・冪等性 (6.4章)・common_user_id解決/merged/assignment変更/
 * reward.granted/reversedの各ハンドラを対象とする。
 */
describe("POST /api/integrations/events (共通実装契約6章)", () => {
  let app: INestApplication;
  let key: TestCommonEventSigningKey;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    key = await createTestCommonEventSigningKey();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.ENABLE_COMMON_EVENT_INBOX = "true";
    process.env.ENABLE_EXTERNAL_REWARD_TYPES = "true";
  });

  function baseBody(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      event_id: `evt_${generateId()}`,
      event_type: "common_user.resolved",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: "agency-system",
      ...overrides,
    };
  }

  async function createAccountWithWallet(): Promise<{ accountId: string; walletId: string }> {
    const accountId = generateId();
    await prisma.oveAccount.create({
      data: { id: accountId, accountCode: `OVE-ACC-TEST-${generateId()}`, status: "ACTIVE" },
    });
    const walletId = generateId();
    await prisma.wallet.create({
      data: { id: walletId, oveAccountId: accountId, walletCode: `OVE-WLT-TEST-${generateId()}`, status: "ACTIVE" },
    });
    return { accountId, walletId };
  }

  describe("認証 (X-SenNoKuni-*)", () => {
    it("rejects requests missing the auth headers", async () => {
      const body = baseBody();
      await request(app.getHttpServer()).post(ENDPOINT).send(body).expect(401);
    });

    it("rejects an unknown key_id", async () => {
      const body = baseBody();
      const headers = commonEventSignedHeaders(key, body);
      await request(app.getHttpServer())
        .post(ENDPOINT)
        .set({ ...headers, "X-SenNoKuni-Key-Id": "unknown-key-id" })
        .send(body)
        .expect(401);
    });

    it("rejects a tampered body (signature mismatch)", async () => {
      const body = baseBody();
      const headers = commonEventSignedHeaders(key, body);
      await request(app.getHttpServer())
        .post(ENDPOINT)
        .set(headers)
        .send({ ...body, source_system_key: "tampered" })
        .expect(401);
    });

    it("rejects a revoked key", async () => {
      const revokedKey = await createTestCommonEventSigningKey();
      await prisma.commonEventSigningKey.update({ where: { keyId: revokedKey.keyId }, data: { status: "REVOKED" } });
      const body = baseBody();
      const headers = commonEventSignedHeaders(revokedKey, body);
      await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(401);
    });

    it("returns 503 when ENABLE_COMMON_EVENT_INBOX is disabled", async () => {
      process.env.ENABLE_COMMON_EVENT_INBOX = "false";
      const body = baseBody();
      const headers = commonEventSignedHeaders(key, body);
      await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(503);
    });
  });

  describe("冪等性 (6.4章)", () => {
    it("returns the cached result for a resend with an identical body", async () => {
      const { accountId } = await createAccountWithWallet();
      const body = baseBody({
        event_type: "common_user.resolved",
        common_user_id: `cu_${generateId()}`,
        source_user_id: accountId,
      });
      const headers = commonEventSignedHeaders(key, body);

      const first = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);
      expect(first.body.cached).toBe(false);

      // 実際の再送はnonce/timestampを都度新しく生成する (nonceは配送試行単位、本文の
      // event_id/内容が同一であることが冪等性判定の対象)。
      const retryHeaders = commonEventSignedHeaders(key, body);
      const second = await request(app.getHttpServer()).post(ENDPOINT).set(retryHeaders).send(body).expect(201);
      expect(second.body.cached).toBe(true);
      expect(second.body.result).toEqual(first.body.result);

      const rows = await prisma.inboundEvent.findMany({ where: { eventId: body.event_id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("SUCCEEDED");
    });

    it("rejects a resend with the same event_id but a different body (409)", async () => {
      const body = baseBody({ common_user_id: `cu_${generateId()}` });
      const headers = commonEventSignedHeaders(key, body);

      await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);

      const tamperedBody = { ...body, common_user_id: `cu_${generateId()}` };
      const tamperedHeaders = commonEventSignedHeaders(key, tamperedBody);
      await request(app.getHttpServer()).post(ENDPOINT).set(tamperedHeaders).send(tamperedBody).expect(409);
    });
  });

  describe("common_user.resolved", () => {
    it("links common_user_id to the account identified by source_user_id", async () => {
      const { accountId } = await createAccountWithWallet();
      const commonUserId = `cu_${generateId()}`;
      const body = baseBody({ event_type: "common_user.resolved", common_user_id: commonUserId, source_user_id: accountId });
      const headers = commonEventSignedHeaders(key, body);

      const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);
      expect(res.body.result.action).toBe("linked");

      const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.commonUserId).toBe(commonUserId);
      expect(account.commonUserLinkedAt).not.toBeNull();
    });

    it("does not overwrite an already-linked, different common_user_id (conflict recorded, not merged)", async () => {
      const { accountId } = await createAccountWithWallet();
      const originalCommonUserId = `cu_${generateId()}`;
      await prisma.oveAccount.update({
        where: { id: accountId },
        data: { commonUserId: originalCommonUserId, commonUserLinkedAt: new Date() },
      });

      const conflictingCommonUserId = `cu_${generateId()}`;
      const body = baseBody({
        event_type: "common_user.resolved",
        common_user_id: conflictingCommonUserId,
        source_user_id: accountId,
      });
      const headers = commonEventSignedHeaders(key, body);

      const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);
      expect(res.body.result.action).toBe("conflict_ignored");

      const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.commonUserId).toBe(originalCommonUserId);
    });
  });

  describe("customer.assignment.changed", () => {
    it("updates assigned_agency_id and locks registration_referrer_agency_id on first set", async () => {
      const { accountId } = await createAccountWithWallet();
      const commonUserId = `cu_${generateId()}`;
      await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId } });

      const body = baseBody({
        event_type: "customer.assignment.changed",
        common_user_id: commonUserId,
        assigned_agency_id: "AGENT-CODE-002",
        registration_referrer_agency_id: "AGENT-CODE-001",
      });
      const headers = commonEventSignedHeaders(key, body);
      await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);

      let account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.assignedAgencyId).toBe("AGENT-CODE-002");
      expect(account.registrationReferrerAgencyId).toBe("AGENT-CODE-001");

      // 2回目のイベントでregistration_referrer_agency_idが異なる値でも上書きされない (ロック)。
      const secondBody = baseBody({
        event_type: "customer.assignment.changed",
        common_user_id: commonUserId,
        assigned_agency_id: "AGENT-CODE-003",
        registration_referrer_agency_id: "AGENT-CODE-999",
      });
      const secondHeaders = commonEventSignedHeaders(key, secondBody);
      await request(app.getHttpServer()).post(ENDPOINT).set(secondHeaders).send(secondBody).expect(201);

      account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.assignedAgencyId).toBe("AGENT-CODE-003");
      expect(account.registrationReferrerAgencyId).toBe("AGENT-CODE-001");
    });
  });

  describe("reward.granted / reward.reversed", () => {
    it("credits OVE with agency-role metadata, then reverses it without mutating the original transaction", async () => {
      const { accountId, walletId } = await createAccountWithWallet();
      const commonUserId = `cu_${generateId()}`;
      await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId } });

      const grantBody = baseBody({
        event_type: "reward.granted",
        common_user_id: commonUserId,
        agency_id: "AGENT-CODE-001",
        registration_referrer_agency_id: "AGENT-CODE-001",
        assigned_agency_id: "AGENT-CODE-002",
        sales_agent_id: "AGENT-CODE-003",
        closing_agent_id: "AGENT-CODE-004",
        order_id: "order-1",
        product_code: "AIART-ANNUAL",
        metadata: { amount: 5000 },
      });
      const grantHeaders = commonEventSignedHeaders(key, grantBody);
      const grantRes = await request(app.getHttpServer()).post(ENDPOINT).set(grantHeaders).send(grantBody).expect(201);
      const transactionId = grantRes.body.result.id as string;
      expect(grantRes.body.result.amount).toBe("5000");

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
      expect(wallet.availableBalance.toString()).toBe("5000");

      const transaction = await prisma.oveTransaction.findUniqueOrThrow({ where: { id: transactionId } });
      expect(transaction.transactionType).toBe("COMMON_EVENT_REWARD");
      expect((transaction.metadata as Record<string, unknown>).salesAgentId).toBe("AGENT-CODE-003");
      expect((transaction.metadata as Record<string, unknown>).closingAgentId).toBe("AGENT-CODE-004");

      // 同一event_idの再送では二重付与されない (冪等性、再送はnonceを新しく生成する)。
      const grantRetryHeaders = commonEventSignedHeaders(key, grantBody);
      const grantRetry = await request(app.getHttpServer()).post(ENDPOINT).set(grantRetryHeaders).send(grantBody).expect(201);
      expect(grantRetry.body.cached).toBe(true);
      const walletAfterRetry = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
      expect(walletAfterRetry.availableBalance.toString()).toBe("5000");

      const reverseBody = baseBody({
        event_type: "reward.reversed",
        common_user_id: commonUserId,
        order_id: "order-1",
        metadata: { original_event_id: grantBody.event_id },
      });
      const reverseHeaders = commonEventSignedHeaders(key, reverseBody);
      await request(app.getHttpServer()).post(ENDPOINT).set(reverseHeaders).send(reverseBody).expect(201);

      const walletAfterReversal = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
      expect(walletAfterReversal.availableBalance.toString()).toBe("0");

      // 元取引は変更されず (append-only)、REVERSEDへの状態遷移のみ。
      const originalAfterReversal = await prisma.oveTransaction.findUniqueOrThrow({ where: { id: transactionId } });
      expect(originalAfterReversal.status).toBe("REVERSED");
      expect(originalAfterReversal.amount.toString()).toBe("5000");
    });

    it("does not move OVE when ENABLE_EXTERNAL_REWARD_TYPES is disabled", async () => {
      process.env.ENABLE_EXTERNAL_REWARD_TYPES = "false";
      const { walletId } = await createAccountWithWallet();
      const commonUserId = `cu_${generateId()}`;
      await prisma.oveAccount.updateMany({ where: { wallet: { id: walletId } }, data: { commonUserId } });

      const body = baseBody({ event_type: "reward.granted", common_user_id: commonUserId, metadata: { amount: 1000 } });
      const headers = commonEventSignedHeaders(key, body);
      const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);
      expect(res.body.result.action).toBe("skipped");

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
      expect(wallet.availableBalance.toString()).toBe("0");
    });
  });

  describe("common_user.merged", () => {
    it("requests a two-person-approval account merge instead of auto-merging when two local accounts exist", async () => {
      const { accountId: sourceId } = await createAccountWithWallet();
      const { accountId: targetId } = await createAccountWithWallet();
      const previousCommonUserId = `cu_${generateId()}`;
      const newCommonUserId = `cu_${generateId()}`;
      await prisma.oveAccount.update({ where: { id: sourceId }, data: { commonUserId: previousCommonUserId } });
      await prisma.oveAccount.update({ where: { id: targetId }, data: { commonUserId: newCommonUserId } });

      const body = baseBody({
        event_type: "common_user.merged",
        common_user_id: newCommonUserId,
        metadata: { previous_common_user_id: previousCommonUserId },
      });
      const headers = commonEventSignedHeaders(key, body);
      const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);

      expect(res.body.result.action).toBe("approval_requested");
      const approvalRequestIds = res.body.result.approval_request_ids as string[];
      expect(approvalRequestIds).toHaveLength(1);
      const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestIds[0] } });
      expect(approval.requestType).toBe("ACCOUNT_MERGE");
      expect(approval.status).toBe("PENDING");
      expect(approval.requestedBy).toContain("system:common_user.merged");

      // 自動統合はしていない (両アカウントとも引き続きACTIVE、残高も変わらない)。
      const source = await prisma.oveAccount.findUniqueOrThrow({ where: { id: sourceId } });
      expect(source.status).toBe("ACTIVE");
    });
  });
});
