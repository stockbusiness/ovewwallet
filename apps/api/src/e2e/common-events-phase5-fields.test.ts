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
 * リファクタリング指示書 Phase 5 (event_type別DTO)「正式フィールド候補」。
 * amount / previous_common_user_id / original_event_id をmetadataではなく
 * トップレベルの正式フィールドとして送信しても、既存のmetadataベースの送信元と
 * 同じ結果になることを検証する (後方互換: 正式フィールド優先、metadataはfallback)。
 */
describe("共通イベント: 正式フィールド (Phase 5) 経由の送信", () => {
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

  it("reward.granted: トップレベルamountだけでmetadataなしでも付与できる", async () => {
    const { accountId, walletId } = await createAccountWithWallet();
    const commonUserId = `cu_${generateId()}`;
    await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId } });

    const grantBody = baseBody({
      event_type: "reward.granted",
      common_user_id: commonUserId,
      product_code: "AIART-ANNUAL",
      amount: 4200,
    });
    const headers = commonEventSignedHeaders(key, grantBody);
    const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(grantBody).expect(201);
    expect(res.body.result.amount).toBe("4200");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.availableBalance.toString()).toBe("4200");
  });

  it("reward.granted→reward.reversed: トップレベルoriginal_event_idだけでmetadataなしでも取消できる", async () => {
    const { accountId, walletId } = await createAccountWithWallet();
    const commonUserId = `cu_${generateId()}`;
    await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId } });

    const grantBody = baseBody({ event_type: "reward.granted", common_user_id: commonUserId, amount: 900 });
    const grantHeaders = commonEventSignedHeaders(key, grantBody);
    await request(app.getHttpServer()).post(ENDPOINT).set(grantHeaders).send(grantBody).expect(201);

    const reverseBody = baseBody({
      event_type: "reward.reversed",
      common_user_id: commonUserId,
      original_event_id: grantBody.event_id,
    });
    const reverseHeaders = commonEventSignedHeaders(key, reverseBody);
    await request(app.getHttpServer()).post(ENDPOINT).set(reverseHeaders).send(reverseBody).expect(201);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.availableBalance.toString()).toBe("0");
  });

  it("common_user.merged: トップレベルprevious_common_user_idだけでmetadataなしでも承認申請できる", async () => {
    const sourceAccountId = generateId();
    await prisma.oveAccount.create({
      data: { id: sourceAccountId, accountCode: `OVE-ACC-TEST-${generateId()}`, status: "ACTIVE" },
    });
    const targetAccountId = generateId();
    await prisma.oveAccount.create({
      data: { id: targetAccountId, accountCode: `OVE-ACC-TEST-${generateId()}`, status: "ACTIVE" },
    });
    const previousCommonUserId = `cu_${generateId()}`;
    const newCommonUserId = `cu_${generateId()}`;
    await prisma.oveAccount.update({ where: { id: sourceAccountId }, data: { commonUserId: previousCommonUserId } });
    await prisma.oveAccount.update({ where: { id: targetAccountId }, data: { commonUserId: newCommonUserId } });

    const body = baseBody({
      event_type: "common_user.merged",
      common_user_id: newCommonUserId,
      previous_common_user_id: previousCommonUserId,
    });
    const headers = commonEventSignedHeaders(key, body);
    const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);

    expect(res.body.result.action).toBe("approval_requested");
    const approvalRequestIds = res.body.result.approval_request_ids as string[];
    expect(approvalRequestIds).toHaveLength(1);
  });
});
