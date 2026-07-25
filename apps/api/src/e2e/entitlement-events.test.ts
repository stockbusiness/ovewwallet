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

/**
 * NFTコレクション実装指示書19章。entitlement.granted/entitlement.revoked の必須E2E。
 * Granted 15シナリオ + Revoked 6シナリオ。
 */
describe("共通イベント: entitlement.granted / entitlement.revoked", () => {
  let app: INestApplication;
  let sengokuKey: TestCommonEventSigningKey;
  let otherKey: TestCommonEventSigningKey;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    sengokuKey = await createTestCommonEventSigningKey(SENGOKU_MARKET);
    otherKey = await createTestCommonEventSigningKey("other-system");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.ENABLE_COMMON_EVENT_INBOX = "true";
    process.env.ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX = "true";
  });

  async function createAccountWithCommonUserId(commonUserId?: string): Promise<{ accountId: string; commonUserId: string }> {
    const accountId = generateId();
    const cuId = commonUserId ?? `cu_${generateId()}`;
    await prisma.oveAccount.create({
      data: { id: accountId, accountCode: `OVE-ACC-TEST-${generateId()}`, status: "ACTIVE", commonUserId: cuId },
    });
    return { accountId, commonUserId: cuId };
  }

  function grantedBody(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      event_id: `evt_${generateId()}`,
      event_type: "entitlement.granted",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: SENGOKU_MARKET,
      entitlement_id: `ent_${generateId()}`,
      order_id: `order_${generateId()}`,
      order_item_id: `item_${generateId()}`,
      product_code: "SENGOKU-CARD-001",
      metadata: {
        entitlement_type: "digital_collectible",
        asset_code: `ASSET-${generateId()}`,
        name: "織田信長カード",
        image_url: "https://example.com/cards/oda.png",
      },
      ...overrides,
    };
  }

  function revokedBody(entitlementId: string, overrides: Partial<Record<string, unknown>> = {}) {
    return {
      event_id: `evt_${generateId()}`,
      event_type: "entitlement.revoked",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: SENGOKU_MARKET,
      entitlement_id: entitlementId,
      metadata: { reason: "refund" },
      ...overrides,
    };
  }

  function postEvent(body: Record<string, unknown>, key: TestCommonEventSigningKey = sengokuKey) {
    const headers = commonEventSignedHeaders(key, body);
    return request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body);
  }

  describe("entitlement.granted", () => {
    it("1. 正常1件: quantity省略でも1件付与される", async () => {
      const { accountId, commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId });
      delete (body as Record<string, unknown>).quantity;

      const res = await postEvent(body).expect(201);
      expect(res.body.result.action).toBe("granted");
      expect(res.body.result.ove_account_id).toBe(accountId);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId: body.entitlement_id },
      });
      expect(holding.oveAccountId).toBe(accountId);
      expect(holding.status).toBe("ACTIVE");
    });

    it("2. 数量1: quantity:1を明示しても付与される", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId, quantity: 1 });

      const res = await postEvent(body).expect(201);
      expect(res.body.result.action).toBe("granted");
    });

    it("3. common_user_id解決: 紐づくOveAccountのholdingとして作成される", async () => {
      const { accountId, commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId });

      await postEvent(body).expect(201);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId: body.entitlement_id },
      });
      expect(holding.oveAccountId).toBe(accountId);
    });

    it("4. Asset新規作成: 未知のasset_codeならCollectibleAssetが新規作成される", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const assetCode = `ASSET-NEW-${generateId()}`;
      const body = grantedBody({
        common_user_id: commonUserId,
        metadata: {
          entitlement_type: "digital_collectible",
          asset_code: assetCode,
          name: "豊臣秀吉カード",
          image_url: "https://example.com/cards/toyotomi.png",
        },
      });

      const res = await postEvent(body).expect(201);
      expect(res.body.result.asset_created).toBe(true);

      const asset = await prisma.collectibleAsset.findUniqueOrThrow({ where: { assetCode } });
      expect(asset.name).toBe("豊臣秀吉カード");
    });

    it("5. Asset既存: 既知のasset_codeは再利用され、内容差異はAuditLogのみに記録される", async () => {
      const assetCode = `ASSET-EXIST-${generateId()}`;
      const first = await createAccountWithCommonUserId();
      const firstBody = grantedBody({
        common_user_id: first.commonUserId,
        metadata: {
          entitlement_type: "digital_collectible",
          asset_code: assetCode,
          name: "徳川家康カード",
          image_url: "https://example.com/cards/tokugawa.png",
        },
      });
      await postEvent(firstBody).expect(201);

      const second = await createAccountWithCommonUserId();
      const secondBody = grantedBody({
        common_user_id: second.commonUserId,
        metadata: {
          entitlement_type: "digital_collectible",
          asset_code: assetCode,
          name: "徳川家康カード(差し替え名)",
          image_url: "https://example.com/cards/tokugawa-v2.png",
        },
      });
      const res = await postEvent(secondBody).expect(201);
      expect(res.body.result.asset_created).toBe(false);

      const asset = await prisma.collectibleAsset.findUniqueOrThrow({ where: { assetCode } });
      expect(asset.name).toBe("徳川家康カード");
      expect(asset.imageUrl).toBe("https://example.com/cards/tokugawa.png");

      const mismatchLog = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_ASSET_MISMATCH", targetId: asset.id },
        orderBy: { createdAt: "desc" },
      });
      expect(mismatchLog).not.toBeNull();
    });

    it("6. Holding作成: order_id/order_item_id/acquired_atが正しく保存される", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId });

      await postEvent(body).expect(201);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId: body.entitlement_id },
      });
      expect(holding.orderId).toBe(body.order_id);
      expect(holding.orderItemId).toBe(body.order_item_id);
      expect(holding.acquiredAt.toISOString()).toBe(new Date(body.occurred_at).toISOString());
      expect(holding.sourceSystemKey).toBe(SENGOKU_MARKET);
    });

    it("7. AuditLog: COLLECTIBLE_GRANTEDが記録される", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId });

      await postEvent(body).expect(201);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId: body.entitlement_id },
      });
      const log = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_GRANTED", targetId: holding.id },
      });
      expect(log).not.toBeNull();
      expect(log?.result).toBe("SUCCESS");
    });

    it("8. 同じevent_id再送: キャッシュされた結果が返り、Holdingは重複作成されない", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId });

      const first = await postEvent(body).expect(201);
      expect(first.body.cached).toBe(false);

      const second = await postEvent(body).expect(201);
      expect(second.body.cached).toBe(true);
      expect(second.body.result).toEqual(first.body.result);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(1);
    });

    it("9. 異なるevent_id・同じentitlement_id: 既存Holdingがそのまま返される", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = `ent_${generateId()}`;
      const firstBody = grantedBody({ common_user_id: commonUserId, entitlement_id: entitlementId });
      const firstRes = await postEvent(firstBody).expect(201);
      const firstHoldingId = firstRes.body.result.holding_id;

      const secondBody = grantedBody({ common_user_id: commonUserId, entitlement_id: entitlementId });
      const secondRes = await postEvent(secondBody).expect(201);
      expect(secondRes.body.result.holding_id).toBe(firstHoldingId);
      expect(secondRes.body.result.asset_created).toBe(false);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId } });
      expect(count).toBe(1);
    });

    it("10. common_user_id競合: 2件以上のOveAccountがヒットすると要レビュー扱いになる", async () => {
      const commonUserId = `cu_${generateId()}`;
      await createAccountWithCommonUserId(commonUserId);
      await createAccountWithCommonUserId(commonUserId);

      const body = grantedBody({ common_user_id: commonUserId });
      const res = await postEvent(body).expect(201);
      expect(res.body.result.action).toBe("common_user_id_conflict_requires_review");
      expect(res.body.result.account_ids).toHaveLength(2);

      const log = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_GRANT_CONFLICT" },
        orderBy: { createdAt: "desc" },
      });
      expect(log).not.toBeNull();

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(0);
    });

    it("11. 不正source_system_key: sengoku-market以外からの送信は拒否される", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId, source_system_key: "other-system" });

      await postEvent(body, otherKey).expect(400);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(0);
    });

    it("12. 不正entitlement_type: digital_collectible以外は拒否される", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({
        common_user_id: commonUserId,
        metadata: { entitlement_type: "physical_goods", asset_code: "X", name: "X", image_url: "https://example.com/x.png" },
      });

      await postEvent(body).expect(400);
    });

    it("13. quantity!=1: 複数数量のイベントは拒否される", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId, quantity: 2 });

      await postEvent(body).expect(400);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(0);
    });

    it("14. Feature Flag OFF: ENABLE_COLLECTIBLE_ENTITLEMENT_INBOXが無効なら何も作らずskippedを返す", async () => {
      process.env.ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX = "false";
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId });

      const res = await postEvent(body).expect(201);
      expect(res.body.result.action).toBe("skipped");

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(0);
    });

    it("15. common_user_id未紐づけ: 対応するOveAccountが無ければ404相当のエラーになる", async () => {
      const body = grantedBody({ common_user_id: `cu_unlinked_${generateId()}` });

      await postEvent(body).expect(404);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(0);
    });
  });

  describe("entitlement.revoked", () => {
    async function grantOne(): Promise<{ entitlementId: string; accountId: string }> {
      const { accountId, commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId });
      await postEvent(body).expect(201);
      return { entitlementId: body.entitlement_id, accountId };
    }

    it("1. ACTIVE→REVOKED: 正常に取消できる", async () => {
      const { entitlementId } = await grantOne();
      const body = revokedBody(entitlementId);

      const res = await postEvent(body).expect(201);
      expect(res.body.result.action).toBe("revoked");

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({ where: { entitlementId } });
      expect(holding.status).toBe("REVOKED");
      expect(holding.revokedAt).not.toBeNull();
    });

    it("2. 再送: 既にREVOKED済みならalready_revokedを返し、AuditLogは重複しない", async () => {
      const { entitlementId } = await grantOne();
      const firstBody = revokedBody(entitlementId);
      await postEvent(firstBody).expect(201);

      const secondBody = revokedBody(entitlementId);
      const res = await postEvent(secondBody).expect(201);
      expect(res.body.result.action).toBe("already_revoked");

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({ where: { entitlementId } });
      const logs = await prisma.auditLog.findMany({
        where: { actionType: "COLLECTIBLE_REVOKED", targetId: holding.id },
      });
      expect(logs).toHaveLength(1);
    });

    it("3. 未存在entitlement_id: 該当Holdingが無ければnot_foundを返す", async () => {
      const body = revokedBody(`ent_unknown_${generateId()}`);

      const res = await postEvent(body).expect(201);
      expect(res.body.result.action).toBe("not_found");
    });

    it("4. 他source: sengoku-market以外の送信元でも取消できる (source制限はgrantedのみ)", async () => {
      const { entitlementId } = await grantOne();
      const body = revokedBody(entitlementId, { source_system_key: "other-system" });

      const res = await postEvent(body, otherKey).expect(201);
      expect(res.body.result.action).toBe("revoked");
    });

    it("5. reason保存: metadata.reasonがrevoke_reasonへ保存される", async () => {
      const { entitlementId } = await grantOne();
      const body = revokedBody(entitlementId, { metadata: { reason: "user_requested_refund" } });

      await postEvent(body).expect(201);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({ where: { entitlementId } });
      expect(holding.revokeReason).toBe("user_requested_refund");
    });

    it("6. Holding削除なし: 取消後も行自体は残り物理削除されない", async () => {
      const { entitlementId, accountId } = await grantOne();
      const body = revokedBody(entitlementId);

      await postEvent(body).expect(201);

      const holding = await prisma.collectibleHolding.findUnique({ where: { entitlementId } });
      expect(holding).not.toBeNull();
      expect(holding?.oveAccountId).toBe(accountId);
    });
  });
});
