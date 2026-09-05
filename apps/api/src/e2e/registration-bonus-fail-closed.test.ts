import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import {
  createTestServiceIntegration,
  signedHeaders,
  type TestServiceIntegration,
} from "./test-helpers";

const GRANT_PATH = "/api/v1/rewards/grant";
const RULE_CODE = "SENGOKU_REGISTRATION_BONUS"; // rule-code-mapping.ts の REGISTRATION_BONUS に対応

async function grant(
  server: Parameters<typeof request>[0],
  integration: TestServiceIntegration,
  body: Record<string, unknown>,
) {
  const headers = signedHeaders(integration, "POST", GRANT_PATH, body);
  return request(server).post(GRANT_PATH).set(headers).send(body);
}

function registrationBonusBody(externalUserId: string) {
  return {
    service_code: "SENGOKU_PASSPORT",
    external_user_id: externalUserId,
    event_type: "MEMBER_REGISTERED",
    event_id: `REG-${generateId()}`,
    amount: 3000,
    transaction_type: "REGISTRATION_BONUS",
    display_name: "戦国パスポート登録特典",
    idempotency_key: `key-${generateId()}`,
  };
}

/**
 * 段階付与(docs/milestone-rewards.md)への移行に伴い、代理店システムからの登録特典3000を
 * 管理画面の「無効化」で確実に止められることを確かめる。fail-openのままだと、無効化は
 * 上限検証を飛ばすだけで付与そのものは通ってしまい、ウォレット側の1000+1000と重なって
 * 合計5000になる。運用担当者が止めたつもりの操作が何も止めていない状態を作らないため。
 */
describe("transaction_type: REGISTRATION_BONUS (代理店システムからの登録特典)", () => {
  let app: INestApplication;
  let integration: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    integration = await createTestServiceIntegration("SENGOKU_PASSPORT", {
      perRequestAmountLimit: 1_000_000,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // seedはこのルールをACTIVEで作る。各テストが状態を変えるため、毎回作り直して
  // 他のe2e (me-and-service-accounts等) が前提とするACTIVEな行を残す。
  afterEach(async () => {
    await prisma.rewardRule.deleteMany({ where: { ruleCode: RULE_CODE } });
    await prisma.rewardRule.create({
      data: {
        id: generateId(),
        ruleCode: RULE_CODE,
        ruleName: "戦国パスポート登録特典",
        sourceService: "SENGOKU_PASSPORT",
        rewardAmount: 3000,
        perUserLimit: 1,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "戦国パスポート登録特典",
      },
    });
  });

  it("管理画面で無効化(INACTIVE)したら、代理店からの3000を拒否する", async () => {
    await prisma.rewardRule.updateMany({
      where: { ruleCode: RULE_CODE },
      data: { status: "INACTIVE" },
    });

    const res = await grant(
      app.getHttpServer(),
      integration,
      registrationBonusBody(`registration-bonus-inactive-${generateId()}`),
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/reward rule .* is required/);
  });

  it("ルールが未登録なら拒否する", async () => {
    await prisma.rewardRule.deleteMany({ where: { ruleCode: RULE_CODE } });

    const res = await grant(
      app.getHttpServer(),
      integration,
      registrationBonusBody(`registration-bonus-missing-${generateId()}`),
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/reward rule .* is required/);
  });

  it("ACTIVEなら従来どおり付与できる (代理店を再開できることの確認)", async () => {
    const res = await grant(
      app.getHttpServer(),
      integration,
      registrationBonusBody(`registration-bonus-active-${generateId()}`),
    );

    expect(res.status).toBe(201);
    expect(res.body.transaction_type).toBe("REGISTRATION_BONUS");
  });

  it("無効化してもウォレット側の付与は止まらない (段階付与は別ルール)", async () => {
    // 代理店の3000を止めることが、ウォレット自身のWALLET_SIGNUP_BONUSまで
    // 巻き込んで止めてしまわないことを確かめる。
    await prisma.rewardRule.updateMany({
      where: { ruleCode: RULE_CODE },
      data: { status: "INACTIVE" },
    });

    const walletRule = await prisma.rewardRule.findUnique({
      where: { ruleCode: "WALLET_SIGNUP_BONUS" },
    });

    expect(walletRule?.status).toBe("ACTIVE");
  });
});
