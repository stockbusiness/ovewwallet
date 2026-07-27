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
import grantedFixture from "../../../../docs/contracts/fixtures/digital-collectible-granted.v1.json";
import revokedFixture from "../../../../docs/contracts/fixtures/digital-collectible-revoked.v1.json";

const ENDPOINT = "/api/integrations/events";
const SENGOKU_MARKET = "sengoku-market";

/**
 * NFTコレクション実装指示書19章 + PR#2最終修正 §15。entitlement.granted/entitlement.revoked
 * の必須E2E。Granted/Revokedの基本シナリオに加え、PR#2最終修正のP0-1〜P1-5を検証する。
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

    it("9. 異なるevent_id・同じentitlement_id (所有者/注文/asset_codeも同一): 既存Holdingがそのまま返される (PR#2最終修正P0-2)", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const entitlementId = `ent_${generateId()}`;
      // PR#2最終修正P0-2以降、冪等成功と判定されるのはowner/送信元/order/asset_codeが
      // すべて一致する場合のみなので、2回目の送信は1回目とまったく同じ内容にする。
      const sharedBody = grantedBody({ common_user_id: commonUserId, entitlement_id: entitlementId });
      const firstRes = await postEvent({ ...sharedBody, event_id: `evt_${generateId()}` }).expect(201);
      const firstHoldingId = firstRes.body.result.holding_id;

      const secondRes = await postEvent({ ...sharedBody, event_id: `evt_${generateId()}` }).expect(201);
      expect(secondRes.body.result.action).toBe("granted");
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

    it("14. Feature Flag OFF: ENABLE_COLLECTIBLE_ENTITLEMENT_INBOXが無効なら503でInbound Eventも作らない (PR#2最終修正P0-3)", async () => {
      process.env.ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX = "false";
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({ common_user_id: commonUserId });

      await postEvent(body).expect(503);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(0);
      // Inbound Event行自体を作らないため、Flag OFF中はevent_idがキャッシュされない。
      const inboundEvent = await prisma.inboundEvent.findUnique({ where: { eventId: body.event_id } });
      expect(inboundEvent).toBeNull();

      // Flag ONに戻せば同じevent_idを再送でき、正常に処理される (取りこぼしがない)。
      process.env.ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX = "true";
      const retryRes = await postEvent(body).expect(201);
      expect(retryRes.body.result.action).toBe("granted");
      const count2 = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count2).toBe(1);
    });

    it("15. common_user_id未紐づけ: 対応するOveAccountが無ければ404相当のエラーになる", async () => {
      const body = grantedBody({ common_user_id: `cu_unlinked_${generateId()}` });

      await postEvent(body).expect(404);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(0);
    });

    it("16. 同一注文2点購入: 同一order_id・同一asset_codeでentitlement_id/serial_numberが異なる2件のentitlement.grantedはHolding 2件・Asset 1件になり、serial_numberは重複しない (不足機能実装指示書PR-W03 quantity=2)", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const orderId = `order_${generateId()}`;
      const assetCode = `ASSET-QTY2-${generateId()}`;
      const bodyA = grantedBody({
        common_user_id: commonUserId,
        order_id: orderId,
        order_item_id: `item_${generateId()}_1`,
        metadata: {
          entitlement_type: "digital_collectible",
          asset_code: assetCode,
          name: "織田信長カード",
          image_url: "https://example.com/cards/oda.png",
          serial_number: "0001",
        },
      });
      const bodyB = grantedBody({
        common_user_id: commonUserId,
        order_id: orderId,
        order_item_id: `item_${generateId()}_2`,
        metadata: {
          entitlement_type: "digital_collectible",
          asset_code: assetCode,
          name: "織田信長カード",
          image_url: "https://example.com/cards/oda.png",
          serial_number: "0002",
        },
      });

      const resA = await postEvent(bodyA).expect(201);
      const resB = await postEvent(bodyB).expect(201);
      expect(resA.body.result.action).toBe("granted");
      expect(resB.body.result.action).toBe("granted");
      expect(resA.body.result.holding_id).not.toBe(resB.body.result.holding_id);

      const holdings = await prisma.collectibleHolding.findMany({
        where: { orderId },
        include: { asset: true },
      });
      expect(holdings).toHaveLength(2);
      expect(new Set(holdings.map((h) => h.asset.assetCode)).size).toBe(1);
      const serials = holdings.map((h) => h.serialNumber).sort();
      expect(serials).toEqual(["0001", "0002"]);
      expect(new Set(serials).size).toBe(2);

      const assetCount = await prisma.collectibleAsset.count({ where: { assetCode } });
      expect(assetCount).toBe(1);
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

    it("4. 他source: sengoku-market以外の送信元からの取消は拒否される (PR#2最終修正P0-1)", async () => {
      const { entitlementId } = await grantOne();
      const body = revokedBody(entitlementId, { source_system_key: "other-system" });

      await postEvent(body, otherKey).expect(403);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({ where: { entitlementId } });
      expect(holding.status).toBe("ACTIVE");

      const log = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_REVOKE_SOURCE_CONFLICT", targetId: holding.id },
        orderBy: { createdAt: "desc" },
      });
      expect(log).not.toBeNull();
      expect(log?.result).toBe("FAILURE");
    });

    it("4b. sourceSystemKeyがsengoku-marketでも付与時と異なるHoldingなら拒否される (PR#2最終修正P0-1)", async () => {
      // Holdingの本来の送信元(付与時に記録されたsourceSystemKey)と、取消リクエストの
      // 認証済みsource_system_keyが一致することも要求する (二重チェック)。
      const entitlementId = `ent_${generateId()}`;
      const holdingId = generateId();
      const asset = await prisma.collectibleAsset.create({
        data: { id: generateId(), assetCode: `ASSET-OTHER-SRC-${generateId()}`, name: "x", imageUrl: "https://example.com/x.png" },
      });
      const { accountId } = await createAccountWithCommonUserId();
      await prisma.collectibleHolding.create({
        data: {
          id: holdingId,
          oveAccountId: accountId,
          collectibleAssetId: asset.id,
          entitlementId,
          sourceSystemKey: "some-other-market",
          acquiredAt: new Date(),
        },
      });

      const body = revokedBody(entitlementId);
      await postEvent(body).expect(403);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({ where: { entitlementId } });
      expect(holding.status).toBe("ACTIVE");
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

    it("7. Mintライフサイクル中(ONCHAIN)のHoldingは自動取消されず要レビュー扱いになる (PR#2最終修正P1-5)", async () => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const { accountId } = await createAccountWithCommonUserId(commonUserId);
      const asset = await prisma.collectibleAsset.create({
        data: { id: generateId(), assetCode: `ASSET-ONCHAIN-${generateId()}`, name: "x", imageUrl: "https://example.com/x.png" },
      });
      const entitlementId = `ent_onchain_${generateId()}`;
      await prisma.collectibleHolding.create({
        data: {
          id: generateId(),
          oveAccountId: accountId,
          collectibleAssetId: asset.id,
          entitlementId,
          sourceSystemKey: SENGOKU_MARKET,
          acquiredAt: new Date(),
          status: "ONCHAIN",
        },
      });

      const body = revokedBody(entitlementId);
      const res = await postEvent(body).expect(201);
      expect(res.body.result.action).toBe("manual_review_required");

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({ where: { entitlementId } });
      expect(holding.status).toBe("ONCHAIN");
      expect(holding.revokedAt).toBeNull();

      const log = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_REVOKE_REQUIRES_REVIEW", targetId: holding.id },
      });
      expect(log).not.toBeNull();
      expect(log?.result).toBe("FAILURE");
    });
  });

  describe("entitlement_id再送時の一致検証 (PR#2最終修正 P0-2)", () => {
    it("別所有者からの再送は競合として拒否され、Holdingは変更されない", async () => {
      const entitlementId = `ent_${generateId()}`;
      const owner = await createAccountWithCommonUserId();
      const firstBody = grantedBody({ common_user_id: owner.commonUserId, entitlement_id: entitlementId });
      const firstRes = await postEvent(firstBody).expect(201);

      const other = await createAccountWithCommonUserId();
      const secondBody = grantedBody({
        common_user_id: other.commonUserId,
        entitlement_id: entitlementId,
        order_id: firstBody.order_id,
        order_item_id: firstBody.order_item_id,
        metadata: firstBody.metadata,
      });
      await postEvent(secondBody).expect(409);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({ where: { entitlementId } });
      expect(holding.id).toBe(firstRes.body.result.holding_id);
      expect(holding.oveAccountId).toBe(owner.accountId);

      const log = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_GRANT_CONFLICT", targetId: holding.id },
        orderBy: { createdAt: "desc" },
      });
      expect(log).not.toBeNull();
      expect(log?.result).toBe("FAILURE");
    });

    it("別order_idからの再送は競合として拒否される", async () => {
      const entitlementId = `ent_${generateId()}`;
      const { commonUserId } = await createAccountWithCommonUserId();
      const firstBody = grantedBody({ common_user_id: commonUserId, entitlement_id: entitlementId });
      await postEvent(firstBody).expect(201);

      const secondBody = grantedBody({
        common_user_id: commonUserId,
        entitlement_id: entitlementId,
        order_id: `order_different_${generateId()}`,
        order_item_id: firstBody.order_item_id,
        metadata: firstBody.metadata,
      });
      await postEvent(secondBody).expect(409);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId } });
      expect(count).toBe(1);
    });

    it("別order_item_idからの再送は競合として拒否される", async () => {
      const entitlementId = `ent_${generateId()}`;
      const { commonUserId } = await createAccountWithCommonUserId();
      const firstBody = grantedBody({ common_user_id: commonUserId, entitlement_id: entitlementId });
      await postEvent(firstBody).expect(201);

      const secondBody = grantedBody({
        common_user_id: commonUserId,
        entitlement_id: entitlementId,
        order_id: firstBody.order_id,
        order_item_id: `item_different_${generateId()}`,
        metadata: firstBody.metadata,
      });
      await postEvent(secondBody).expect(409);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId } });
      expect(count).toBe(1);
    });

    it("別asset_codeからの再送は競合として拒否され、Assetも変更されない", async () => {
      const entitlementId = `ent_${generateId()}`;
      const { commonUserId } = await createAccountWithCommonUserId();
      const firstBody = grantedBody({ common_user_id: commonUserId, entitlement_id: entitlementId });
      await postEvent(firstBody).expect(201);
      const originalAssetCode = (firstBody.metadata as Record<string, unknown>).asset_code as string;

      const secondBody = grantedBody({
        common_user_id: commonUserId,
        entitlement_id: entitlementId,
        order_id: firstBody.order_id,
        order_item_id: firstBody.order_item_id,
        metadata: {
          entitlement_type: "digital_collectible",
          asset_code: `ASSET-DIFFERENT-${generateId()}`,
          name: "別のカード",
          image_url: "https://example.com/cards/different.png",
        },
      });
      await postEvent(secondBody).expect(409);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({
        where: { entitlementId },
        include: { asset: true },
      });
      expect(holding.asset.assetCode).toBe(originalAssetCode);
    });
  });

  describe("asset_code同時作成競合の防止 (PR#2最終修正 P1-1)", () => {
    it("同じasset_code・異なるentitlement_idの20件同時付与でAsset=1件・Holding=20件・失敗0件", async () => {
      const assetCode = `ASSET-CONCURRENT-${generateId()}`;
      const accounts = await Promise.all(Array.from({ length: 20 }, () => createAccountWithCommonUserId()));

      const results = await Promise.all(
        accounts.map((account) =>
          postEvent(
            grantedBody({
              common_user_id: account.commonUserId,
              metadata: {
                entitlement_type: "digital_collectible",
                asset_code: assetCode,
                name: "並行テストカード",
                image_url: "https://example.com/cards/concurrent.png",
              },
            }),
          ),
        ),
      );

      const failures = results.filter((res) => res.status !== 201);
      expect(failures).toHaveLength(0);

      const assetCount = await prisma.collectibleAsset.count({ where: { assetCode } });
      expect(assetCount).toBe(1);

      const holdingCount = await prisma.collectibleHolding.count({
        where: { asset: { assetCode } },
      });
      expect(holdingCount).toBe(20);
    }, 30000);
  });

  describe("外部イベント画像URLの安全性検証 (PR#2最終修正 P1-2)", () => {
    it.each([
      ["HTTP", "http://example.com/cards/oda.png"],
      ["SVG", "https://example.com/cards/oda.svg"],
      ["localhost", "https://localhost/cards/oda.png"],
      ["loopback IP", "https://127.0.0.1/cards/oda.png"],
      ["private IP (10.0.0.0/8)", "https://10.1.2.3/cards/oda.png"],
      ["link-local IP", "https://169.254.169.254/cards/oda.png"],
    ])("%sの画像URLは拒否される", async (_label, imageUrl) => {
      const { commonUserId } = await createAccountWithCommonUserId();
      const body = grantedBody({
        common_user_id: commonUserId,
        metadata: {
          entitlement_type: "digital_collectible",
          asset_code: `ASSET-BADIMG-${generateId()}`,
          name: "不正画像カード",
          image_url: imageUrl,
        },
      });

      await postEvent(body).expect(400);

      const count = await prisma.collectibleHolding.count({ where: { entitlementId: body.entitlement_id } });
      expect(count).toBe(0);
    });
  });

  describe("契約Fixture (PR#2最終修正 P0-4)", () => {
    it("digital-collectible-granted/revoked.v1.jsonの形状 (業務項目トップレベル+metadata) をそのまま受理する", async () => {
      const commonUserId = `cu_${generateId()}`;
      const entitlementId = `ent_fixture_${generateId()}`;
      const { accountId } = await createAccountWithCommonUserId(commonUserId);

      // フィクスチャの構造 (トップレベルの業務項目 + metadata配下の表示項目) はそのまま使い、
      // 一意制約に関わる識別子だけをテスト実行ごとに差し替える。
      const grantedEventBody = {
        ...grantedFixture,
        event_id: `evt_${generateId()}`,
        common_user_id: commonUserId,
        entitlement_id: entitlementId,
        order_id: `order_${generateId()}`,
        order_item_id: `item_${generateId()}`,
        metadata: { ...grantedFixture.metadata, asset_code: `${grantedFixture.metadata.asset_code}-${generateId()}` },
      };

      const grantRes = await postEvent(grantedEventBody).expect(201);
      expect(grantRes.body.result.action).toBe("granted");
      expect(grantRes.body.result.ove_account_id).toBe(accountId);

      const holding = await prisma.collectibleHolding.findUniqueOrThrow({ where: { entitlementId } });
      expect(holding.serialNumber).toBe(grantedFixture.metadata.serial_number);
      expect(holding.displayNameSnapshot).toBe(grantedFixture.metadata.name);
      expect(holding.orderId).toBe(grantedEventBody.order_id);

      const revokedEventBody = { ...revokedFixture, event_id: `evt_${generateId()}`, entitlement_id: entitlementId };
      const revokeRes = await postEvent(revokedEventBody).expect(201);
      expect(revokeRes.body.result.action).toBe("revoked");
    });
  });
});
