import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import {
  createTestCommonEventSigningKey,
  commonEventSignedHeaders,
  type TestCommonEventSigningKey,
} from "./test-helpers";

const ENDPOINT = "/api/integrations/events";
const SENGOKU_MARKET = "sengoku-market";
const SENNOKUNI_NFT_MARKET = "sennokuni-nft-market";
const SENGOKU_COMMERCE = "sengoku-commerce"; // 戦国マーケットの正式source_system_key(5システム決定1)。entitlement系では常に拒否される想定。

/**
 * PR-W3-a: 千ノ国NFTマーケット契約M3a (event_version 1.1) と、PR-W3-aで追加した
 * reason_code・取消追跡情報・Market別名の信頼境界を検証する。既存の
 * entitlement-events.test.ts(1.0契約の網羅的テスト)とは独立したファイルとして追加する。
 */
describe("共通イベント: entitlement.granted / entitlement.revoked (PR-W3-a: event_version 1.1)", () => {
  let app: INestApplication;
  let sengokuKey: TestCommonEventSigningKey;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    sengokuKey = await createTestCommonEventSigningKey(SENGOKU_MARKET);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.ENABLE_COMMON_EVENT_INBOX = "true";
    process.env.ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX = "true";
  });

  async function createAccountWithCommonUserId(): Promise<{
    accountId: string;
    commonUserId: string;
  }> {
    const accountId = generateId();
    const commonUserId = `cu_${generateId()
      .replace(/[^0-9a-f]/gi, "0")
      .padEnd(32, "0")
      .slice(0, 32)
      .toLowerCase()}`;
    await prisma.oveAccount.create({
      data: {
        id: accountId,
        accountCode: `OVE-ACC-TEST-${generateId()}`,
        status: "ACTIVE",
        commonUserId,
      },
    });
    return { accountId, commonUserId };
  }

  function grantedBodyV1_1(
    commonUserId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const entitlementId = `ent_${generateId()}`;
    return {
      event_id: `evt_${generateId()}`,
      event_type: "entitlement.granted",
      event_version: "1.1",
      occurred_at: new Date().toISOString(),
      source_system_key: SENGOKU_MARKET,
      target_site_key: "ovew-wallet",
      correlation_id: `corr_${generateId()}`,
      common_user_id: commonUserId,
      data: {
        entitlement_id: entitlementId,
        order_id: `order_${generateId()}`,
        order_item_id: `item_${generateId()}`,
        product_code: "SENGOKU-CARD-001",
      },
      metadata: {
        entitlement_type: "digital_collectible",
        asset_code: `ASSET-${generateId()}`,
        name: "織田信長カード",
        image_url: "https://example.com/cards/oda.png",
      },
      ...overrides,
    };
  }

  /** V2レビュー指摘1の完全payload例(戦国マーケットM3a、data.artwork_id/product_code含む)。 */
  function revokedBodyV1_1(
    entitlementId: string,
    commonUserId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      event_id: `evt_rvk_${entitlementId}`,
      event_type: "entitlement.revoked",
      event_version: "1.1",
      occurred_at: new Date().toISOString(),
      source_system_key: SENNOKUNI_NFT_MARKET,
      target_site_key: "ovew-wallet",
      correlation_id: `corr_${generateId()}`,
      common_user_id: commonUserId,
      reason_code: "full_refund",
      data: {
        entitlement_id: entitlementId,
        order_id: `order_${generateId()}`,
        order_item_id: `item_${generateId()}`,
        artwork_id: `art_${generateId()}`,
        product_code: null,
      },
      ...overrides,
    };
  }

  function postEvent(
    body: Record<string, unknown>,
    key: TestCommonEventSigningKey = sengokuKey,
  ) {
    const headers = commonEventSignedHeaders(key, body);
    return request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body);
  }

  async function grantActiveHolding(commonUserId: string): Promise<string> {
    const body = grantedBodyV1_1(commonUserId);
    await postEvent(body).expect(201);
    return (body.data as { entitlement_id: string }).entitlement_id;
  }

  describe("entitlement.revoked 1.1: 完全payload契約テスト", () => {
    it("戦国マーケットM3aの完全payload(data.artwork_id含む)を受理し、REVOKEDへ遷移させる", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);

      const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
      const body = revokedBodyV1_1(entitlementId, commonUserId);
      const res = await postEvent(body, key).expect(201);
      expect(res.body.result.action).toBe("revoked");

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId },
      });
      expect(holding.status).toBe("REVOKED");
      expect(holding.revokeReasonCode).toBe("full_refund");
      expect(holding.revokedBySourceSystemKey).toBe(SENNOKUNI_NFT_MARKET);
      expect(holding.revokedByEventId).toBe(body.event_id);
      expect(holding.revokedCorrelationId).toBe(body.correlation_id);
      expect(holding.revokedOccurredAt).not.toBeNull();
      // payload.data.artwork_id等はpassthroughでInboundEvent.payloadへ保持される(業務ロジックでは未使用)。
      const inboundEvent = await prisma.inboundEvent.findFirstOrThrow({
        where: { eventId: body.event_id },
      });
      expect(
        (inboundEvent.payload as { data: { artwork_id: string } }).data
          .artwork_id,
      ).toBe((body.data as { artwork_id: string }).artwork_id);
    });

    it("event_version 1.1でdata.entitlement_idが無く、トップレベルentitlement_idだけの場合は400になる(トップレベルへのフォールバック禁止)", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);

      const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
      const body = revokedBodyV1_1(entitlementId, commonUserId, {
        entitlement_id: entitlementId, // トップレベルのみ
        data: { order_id: "x" }, // data.entitlement_idを意図的に欠落させる
      });
      await postEvent(body, key).expect(400);
    });

    it("1.0では従来どおりtarget_site_key/correlation_id/reason_code無しでも成功する(既存契約を維持)", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);

      const legacyBody = {
        event_id: `evt_${generateId()}`,
        event_type: "entitlement.revoked",
        event_version: "1.0",
        occurred_at: new Date().toISOString(),
        source_system_key: SENGOKU_MARKET,
        entitlement_id: entitlementId,
        metadata: { reason: "refund" },
      };
      await postEvent(legacyBody).expect(201);
    });

    const missingFieldCases: Array<[string, Record<string, unknown>]> = [
      ["common_user_idなし", { common_user_id: undefined }],
      ["common_user_id=null", { common_user_id: null }],
      ["reason_codeなし", { reason_code: undefined }],
      ["reason_code=null", { reason_code: null }],
      ["correlation_idなし", { correlation_id: undefined }],
      ["target_site_key不一致", { target_site_key: "some-other-wallet" }],
    ];
    it.each(missingFieldCases)(
      "1.1で%sの場合は400になる",
      async (_label, overrides) => {
        const { commonUserId } = await createAccountWithCommonUserId();
        const entitlementId = await grantActiveHolding(commonUserId);
        const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
        const body = revokedBodyV1_1(entitlementId, commonUserId, overrides);
        await postEvent(body, key).expect(400);
      },
    );

    it("occurred_atが有効なISO 8601 UTCでない場合は400になる(Invalid Dateや現在時刻への自動置換をしない)", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);
      const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
      const body = revokedBodyV1_1(entitlementId, commonUserId, {
        occurred_at: "not-a-date",
      });
      await postEvent(body, key).expect(400);
    });

    it("common_user_idが cu_[0-9a-f]{32} 形式でない場合は400になる", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);
      const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
      const body = revokedBodyV1_1(entitlementId, commonUserId, {
        common_user_id: "not-valid",
      });
      await postEvent(body, key).expect(400);
    });
  });

  describe("entitlement.granted 1.1: 必須項目", () => {
    it("完全なpayloadを受理する", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBodyV1_1(commonUserId);
      const res = await postEvent(body).expect(201);
      expect(res.body.result.action).toBe("granted");
    });

    it("common_user_idが無い場合は400になる", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBodyV1_1(commonUserId, { common_user_id: undefined });
      await postEvent(body).expect(400);
    });

    it("data.entitlement_idが無い場合(トップレベルのみ)は400になる", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBodyV1_1(commonUserId);
      const { entitlement_id } = body.data as { entitlement_id: string };
      const malformed = { ...body, entitlement_id, data: { order_id: "x" } };
      await postEvent(malformed).expect(400);
    });
  });

  describe("event_type別のevent_version管理", () => {
    it("entitlement以外のevent_typeでevent_version=1.1を送ると422になる", async () => {
      const body = {
        event_id: `evt_${generateId()}`,
        event_type: "reward.granted",
        event_version: "1.1",
        occurred_at: new Date().toISOString(),
        source_system_key: SENGOKU_MARKET,
      };
      await postEvent(body).expect(422);
    });

    it("ハンドラ未登録だが契約上正当なevent_type(例: order.created)はversion1.0ならack-only 200のまま(既存の意図的な契約準拠動作を維持)", async () => {
      const body = {
        event_id: `evt_${generateId()}`,
        event_type: "order.created",
        event_version: "1.0",
        occurred_at: new Date().toISOString(),
        source_system_key: SENGOKU_MARKET,
      };
      const res = await postEvent(body).expect(201);
      expect(res.body.result.note).toContain("no handler registered");
    });

    it("ハンドラ未登録のevent_typeでevent_version=1.1を送ると422になる(DEFAULT_SUPPORTED_EVENT_VERSIONS)", async () => {
      const body = {
        event_id: `evt_${generateId()}`,
        event_type: "order.created",
        event_version: "1.1",
        occurred_at: new Date().toISOString(),
        source_system_key: SENGOKU_MARKET,
      };
      await postEvent(body).expect(422);
    });
  });

  describe("未知reason_code", () => {
    it("形式上正しいが未知のreason_codeは受理してREVOKEDにし、汎用文言用のフォールバック・監査ログを記録する", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);
      const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
      const body = revokedBodyV1_1(entitlementId, commonUserId, {
        reason_code: "some_other_reason",
      });
      const res = await postEvent(body, key).expect(201);
      expect(res.body.result.action).toBe("revoked");

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId },
      });
      expect(holding.status).toBe("REVOKED");
      expect(holding.revokeReasonCode).toBe("some_other_reason");

      const auditRows = await prisma.auditLog.findMany({
        where: {
          actionType: "COLLECTIBLE_REVOKE_UNKNOWN_REASON_CODE",
          targetId: holding.id,
        },
      });
      expect(auditRows).toHaveLength(1);
      expect(
        (auditRows[0]!.afterData as Record<string, unknown>).reasonCode,
      ).toBe("some_other_reason");
    });

    it("既知のreason_code(full_refund)では未知reason_code監査ログを作らない", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);
      const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
      const body = revokedBodyV1_1(entitlementId, commonUserId, {
        reason_code: "full_refund",
      });
      await postEvent(body, key).expect(201);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId },
      });
      const auditRows = await prisma.auditLog.findMany({
        where: {
          actionType: "COLLECTIBLE_REVOKE_UNKNOWN_REASON_CODE",
          targetId: holding.id,
        },
      });
      expect(auditRows).toHaveLength(0);
    });

    const invalidReasonCodeCases: Array<[string, string]> = [
      ["65文字以上", "a".repeat(65)],
      ["改行入り", "full_refund\nmore"],
      ["空白入り", "full refund"],
      ["大文字混入", "Full_Refund"],
      ["記号入り", "full-refund!"],
    ];
    it.each(invalidReasonCodeCases)(
      "reason_codeが%s形式不正の場合は400になる",
      async (_label, reasonCode) => {
        const { commonUserId } = await createAccountWithCommonUserId();
        const entitlementId = await grantActiveHolding(commonUserId);
        const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
        const body = revokedBodyV1_1(entitlementId, commonUserId, {
          reason_code: reasonCode,
        });
        await postEvent(body, key).expect(400);
      },
    );

    it("同一event_idの再処理では未知reason_code監査ログが重複記録されない", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);
      const key = await createTestCommonEventSigningKey(SENNOKUNI_NFT_MARKET);
      const body = revokedBodyV1_1(entitlementId, commonUserId, {
        reason_code: "some_other_reason",
      });

      await postEvent(body, key).expect(201);
      const res2 = await postEvent(body, key).expect(201); // 同一event_id・同一payloadの再送(冪等キャッシュ)
      expect(res2.body.cached).toBe(true);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId },
      });
      const auditRows = await prisma.auditLog.findMany({
        where: {
          actionType: "COLLECTIBLE_REVOKE_UNKNOWN_REASON_CODE",
          targetId: holding.id,
        },
      });
      expect(auditRows).toHaveLength(1);
    });
  });

  describe("Market別名の信頼境界", () => {
    it("戦国マーケットの正式source_system_key(sengoku-commerce)からのentitlement.grantedは拒否される", async () => {
      const key = await createTestCommonEventSigningKey(SENGOKU_COMMERCE);
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBodyV1_1(commonUserId, {
        source_system_key: SENGOKU_COMMERCE,
      });
      await postEvent(body, key).expect(400);
    });

    it("戦国マーケットの正式source_system_key(sengoku-commerce)からのentitlement.revokedは拒否される(403、source_conflict)", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = await grantActiveHolding(commonUserId);
      const key = await createTestCommonEventSigningKey(SENGOKU_COMMERCE);
      const body = revokedBodyV1_1(entitlementId, commonUserId, {
        source_system_key: SENGOKU_COMMERCE,
      });
      const res = await postEvent(body, key).expect(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe("FORBIDDEN");

      // Holdingは変更されず、ACTIVEのままであることを確認する(誤って別Marketが取消せない)。
      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId },
      });
      expect(holding.status).toBe("ACTIVE");
    });
  });
});
