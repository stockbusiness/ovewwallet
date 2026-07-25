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
 * リファクタリング指示書 Phase 6 (GrantRewardUseCase共通化) の回帰テスト。
 * 旧`RewardGrantedHandler`は`RewardsService.grant`(外部サービスAPI経由) と異なり
 * reward_ruleの`expiry_days`を台帳付与に反映していなかった (`creditWallet`へ
 * `expiresAt`を渡していなかった)。`GrantRewardUseCase`への統合により、
 * 共通イベント経由の付与でも`expiry_days`が正しく`OveCreditLot`として記録される
 * ことを検証する。
 */
describe("共通イベントreward.granted: reward_ruleのexpiry_daysが台帳に反映される (Phase 6回帰テスト)", () => {
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

  it("expiry_daysが設定されたreward_ruleでOveCreditLotが作成される", async () => {
    const accountId = generateId();
    await prisma.oveAccount.create({
      data: { id: accountId, accountCode: `OVE-ACC-TEST-${generateId()}`, status: "ACTIVE" },
    });
    const walletId = generateId();
    await prisma.wallet.create({
      data: { id: walletId, oveAccountId: accountId, walletCode: `OVE-WLT-TEST-${generateId()}`, status: "ACTIVE" },
    });
    const commonUserId = `cu_${generateId()}`;
    await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId } });

    const productCode = `PROD-EXPIRY-${generateId()}`;
    await prisma.rewardRule.create({
      data: {
        id: generateId(),
        ruleCode: `COMMON_EVENT_REWARD:${productCode}`,
        ruleName: "Phase 6 expiry regression rule",
        sourceService: "SENGOKU_EC",
        rewardAmount: 300n,
        displayName: "Phase 6 expiry regression rule",
        status: "ACTIVE",
        expiryDays: 30,
      },
    });

    const body = {
      event_id: `evt_${generateId()}`,
      event_type: "reward.granted",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: "agency-system",
      common_user_id: commonUserId,
      product_code: productCode,
      amount: 300,
    };
    const headers = commonEventSignedHeaders(key, body);
    const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);
    const transactionId = res.body.result.id as string;

    const lot = await prisma.oveCreditLot.findFirstOrThrow({ where: { transactionId } });
    expect(lot.amount.toString()).toBe("300");
    expect(lot.remainingAmount.toString()).toBe("300");
    expect(lot.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.availableBalance.toString()).toBe("300");
  });
});
