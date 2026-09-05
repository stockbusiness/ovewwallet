import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestCommonEventSigningKey, commonEventSignedHeaders, type TestCommonEventSigningKey } from "./test-helpers";

const SENGOKU_MARKET = "sengoku-market";
const EVENTS_ENDPOINT = "/api/integrations/events";

/**
 * 不足機能実装指示書 PR-W03「NFT結合試験」。これまでClaim導線 (`collectible-claims.test.ts`)
 * とentitlement.granted/revoked (`entitlement-events.test.ts`) は別々のE2Eでしか検証しておらず、
 * 「Market側のClaim状態=DELIVERED」と「Wallet側のHolding=ACTIVE」が実際に揃うことは
 * 未検証だった (`GetClaimOverviewUseCase`はMarketへ毎回問い合わせるだけで、Holdingの有無を
 * 一切見ていないため、この2つは独立した情報源)。本ファイルは両者を1つの流れでつなぐ。
 */
describe("NFT結合試験: Claim確定 → entitlement.granted → Holding ACTIVE → Collection表示 (PR-W03)", () => {
  let app: INestApplication;
  let marketServer: http.Server;
  let sengokuKey: TestCommonEventSigningKey;
  const store = new Map<string, { confirmed: boolean; delivered: boolean }>();

  beforeAll(async () => {
    marketServer = http.createServer((req, res) => {
      const url = req.url ?? "";
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      if (req.method === "GET") {
        const tokenMatch = url.match(/\/api\/collectible-claims\/([^/?]+)/);
        const token = tokenMatch ? decodeURIComponent(tokenMatch[1]!) : "";
        const entry = store.get(token);
        if (entry?.delivered) return json(200, { status: "DELIVERED", card_name: "織田信長 SSR (結合試験)" });
        if (entry?.confirmed) return json(200, { status: "DELIVERY_PENDING", card_name: "織田信長 SSR (結合試験)" });
        return json(200, { status: "PENDING", card_name: "織田信長 SSR (結合試験)" });
      }

      // POST .../confirm
      const tokenMatch = url.match(/\/api\/collectible-claims\/([^/?]+)\/confirm/);
      const token = tokenMatch ? decodeURIComponent(tokenMatch[1]!) : "";
      store.set(token, { confirmed: true, delivered: false });
      return json(202, { status: "DELIVERY_PENDING" });
    });
    await new Promise<void>((resolve) => marketServer.listen(0, "127.0.0.1", resolve));
    const { port } = marketServer.address() as AddressInfo;

    process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
    process.env.ENABLE_COMMON_EVENT_INBOX = "true";
    process.env.ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX = "true";
    process.env.ENABLE_DIGITAL_COLLECTION = "true";
    process.env.SENGOKU_MARKET_CLAIM_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.SENGOKU_MARKET_CLAIM_KEY_ID = "test-integration-claim-key";
    process.env.SENGOKU_MARKET_CLAIM_HMAC_SECRET = "test-integration-claim-secret";

    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    sengokuKey = await createTestCommonEventSigningKey(SENGOKU_MARKET);
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => marketServer.close(() => resolve()));
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
    process.env.ENABLE_COMMON_EVENT_INBOX = "true";
    process.env.ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX = "true";
    process.env.ENABLE_DIGITAL_COLLECTION = "true";
  });

  async function loginAsNewUser(): Promise<{ cookie: string[]; oveAccountId: string }> {
    const idToken = `mock.${generateId()}`;
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    return { cookie: res.headers["set-cookie"] as unknown as string[], oveAccountId: res.body.ove_account_id };
  }

  function postEntitlementEvent(body: Record<string, unknown>) {
    const headers = commonEventSignedHeaders(sengokuKey, body);
    return request(app.getHttpServer()).post(EVENTS_ENDPOINT).set(headers).send(body);
  }

  it("golden path: Claim確定後にentitlement.grantedが届くと、Market=DELIVEREDとWallet Holding=ACTIVEが揃い、コレクションに表示される", async () => {
    const { cookie, oveAccountId } = await loginAsNewUser();
    const commonUserId = `cu_int_${generateId()}`;
    await prisma.oveAccount.update({ where: { id: oveAccountId }, data: { commonUserId } });

    const token = `int-golden-${generateId()}`;
    const assetCode = `ASSET-INT-${generateId()}`;
    const orderId = `order_int_${generateId()}`;

    // 1. Confirm前はMarket=PENDING、Wallet側にHoldingはまだ無い。
    const before = await request(app.getHttpServer()).get(`/api/v1/collectible-claims/${token}`).set("Cookie", cookie).expect(200);
    expect(before.body.status).toBe("PENDING");

    // 2. 受け取る (Confirm)。
    const confirmRes = await request(app.getHttpServer())
      .post(`/api/v1/collectible-claims/${token}/confirm`)
      .set("Cookie", cookie)
      .expect(202);
    expect(confirmRes.body.ok).toBe(true);
    expect(confirmRes.body.status).toBe("DELIVERY_PENDING");

    const pendingOverview = await request(app.getHttpServer())
      .get(`/api/v1/collectible-claims/${token}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(pendingOverview.body.status).toBe("DELIVERY_PENDING");
    // この時点ではまだHoldingは存在しない (MarketのDELIVERY_PENDINGとWallet Holdingは独立した情報源)。
    const holdingsBeforeGrant = await request(app.getHttpServer()).get("/api/v1/me/collectibles").set("Cookie", cookie).expect(200);
    expect(holdingsBeforeGrant.body.items).toHaveLength(0);

    // 3. 戦国マーケットが (Claim確定とは非同期に) entitlement.grantedを送ってくる。
    const entitlementId = `ent_int_${generateId()}`;
    const grantedBody = {
      event_id: `evt_${generateId()}`,
      event_type: "entitlement.granted",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: SENGOKU_MARKET,
      entitlement_id: entitlementId,
      order_id: orderId,
      order_item_id: `item_${generateId()}`,
      product_code: "SENGOKU-CARD-INT-001",
      common_user_id: commonUserId,
      metadata: {
        entitlement_type: "digital_collectible",
        asset_code: assetCode,
        name: "織田信長 SSR (結合試験)",
        image_url: "https://example.com/cards/oda-int.png",
        serial_number: "0001",
      },
    };
    const grantRes = await postEntitlementEvent(grantedBody).expect(201);
    expect(grantRes.body.result.action).toBe("granted");

    // 4. マーケット側もDELIVEREDへ遷移 (実運用ではMarket内部の送付完了と連動する)。
    store.set(token, { confirmed: true, delivered: true });

    // 5. ポーリング相当のGET: Market=DELIVERED かつ Wallet Holding=ACTIVE が揃っている。
    const deliveredOverview = await request(app.getHttpServer())
      .get(`/api/v1/collectible-claims/${token}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(deliveredOverview.body.status).toBe("DELIVERED");

    const collection = await request(app.getHttpServer()).get("/api/v1/me/collectibles").set("Cookie", cookie).expect(200);
    expect(collection.body.items).toHaveLength(1);
    const holding = await prisma.collectibleHolding.findFirst({
      where: { entitlementId },
      include: { asset: true },
    });
    expect(holding).not.toBeNull();
    expect(holding?.status).toBe("ACTIVE");
    expect(holding?.oveAccountId).toBe(oveAccountId);
    expect(holding?.asset.assetCode).toBe(assetCode);
    expect(collection.body.items[0].holding_id).toBe(holding?.id);
  });

  it("Claim確定後にentitlement.revokedが届くと、HoldingがREVOKEDになりコレクション既定表示から除外される (返金結合試験)", async () => {
    const { cookie, oveAccountId } = await loginAsNewUser();
    const commonUserId = `cu_int_revoke_${generateId()}`;
    await prisma.oveAccount.update({ where: { id: oveAccountId }, data: { commonUserId } });

    const token = `int-revoke-${generateId()}`;
    const entitlementId = `ent_int_revoke_${generateId()}`;

    await request(app.getHttpServer()).post(`/api/v1/collectible-claims/${token}/confirm`).set("Cookie", cookie).expect(202);

    const grantedBody = {
      event_id: `evt_${generateId()}`,
      event_type: "entitlement.granted",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: SENGOKU_MARKET,
      entitlement_id: entitlementId,
      order_id: `order_int_revoke_${generateId()}`,
      order_item_id: `item_${generateId()}`,
      common_user_id: commonUserId,
      metadata: {
        entitlement_type: "digital_collectible",
        asset_code: `ASSET-INT-REVOKE-${generateId()}`,
        name: "返金結合試験カード",
        image_url: "https://example.com/cards/refund-int.png",
      },
    };
    await postEntitlementEvent(grantedBody).expect(201);

    const activeCollection = await request(app.getHttpServer()).get("/api/v1/me/collectibles").set("Cookie", cookie).expect(200);
    expect(activeCollection.body.items).toHaveLength(1);

    // Market側が返金理由でentitlement.revokedを送ってくる (Claim確定後・付与成功後の返金)。
    const revokedBody = {
      event_id: `evt_${generateId()}`,
      event_type: "entitlement.revoked",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: SENGOKU_MARKET,
      entitlement_id: entitlementId,
      metadata: { reason: "refund (結合試験)" },
    };
    const revokeRes = await postEntitlementEvent(revokedBody).expect(201);
    expect(revokeRes.body.result.action).toBe("revoked");

    const holding = await prisma.collectibleHolding.findFirst({ where: { entitlementId } });
    expect(holding?.status).toBe("REVOKED");
    // 物理削除禁止 (指示書§15) — 行自体は残る。
    expect(holding).not.toBeNull();

    const collectionAfterRevoke = await request(app.getHttpServer()).get("/api/v1/me/collectibles").set("Cookie", cookie).expect(200);
    expect(collectionAfterRevoke.body.items).toHaveLength(0);
  });
});
