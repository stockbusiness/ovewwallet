import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * NFTコレクション実装指示書 Phase 3。本人向け`GET /api/v1/me/collectibles`
 * (一覧・詳細) と管理画面向けカードマスターCRUD・保有検索・手動取消。
 */
describe("NFTコレクション API (Phase 3)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-collectibles-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Collectibles Admin",
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
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

  async function createAsset(overrides: Partial<Record<string, unknown>> = {}) {
    const assetCode = `ASSET-API-${generateId()}`;
    return prisma.collectibleAsset.create({
      data: {
        id: generateId(),
        assetCode,
        name: "上杉謙信カード",
        imageUrl: "https://example.com/cards/uesugi.png",
        ...overrides,
      },
    });
  }

  async function createHolding(oveAccountId: string, assetId: string, overrides: Partial<Record<string, unknown>> = {}) {
    return prisma.collectibleHolding.create({
      data: {
        id: generateId(),
        oveAccountId,
        collectibleAssetId: assetId,
        entitlementId: `ent_api_${generateId()}`,
        sourceSystemKey: "sengoku-market",
        logicalMarket: "nft-art-market",
        acquiredAt: new Date(),
        ...overrides,
      },
    });
  }

  describe("GET /api/v1/me/collectibles", () => {
    it("既定ではACTIVEのみ返し、REVOKEDは除外する", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      const asset = await createAsset();
      const active = await createHolding(oveAccountId, asset.id);
      await createHolding(oveAccountId, asset.id, { status: "REVOKED", revokedAt: new Date(), revokeReason: "test" });

      const res = await request(app.getHttpServer()).get("/api/v1/me/collectibles").set("Cookie", cookie).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].holding_id).toBe(active.id);
    });

    it("include_revoked=trueならREVOKEDも含む", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      const asset = await createAsset();
      await createHolding(oveAccountId, asset.id);
      await createHolding(oveAccountId, asset.id, { status: "REVOKED", revokedAt: new Date(), revokeReason: "test" });

      const res = await request(app.getHttpServer())
        .get("/api/v1/me/collectibles?include_revoked=true")
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.items).toHaveLength(2);
    });

    it("他人のHoldingは一覧に出ない", async () => {
      const me = await loginAsNewUser();
      const other = await loginAsNewUser();
      const asset = await createAsset();
      await createHolding(other.oveAccountId, asset.id);

      const res = await request(app.getHttpServer()).get("/api/v1/me/collectibles").set("Cookie", me.cookie).expect(200);
      expect(res.body.items).toHaveLength(0);
    });

    it("limitとnext_cursorでページングできる", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      const asset = await createAsset();
      await createHolding(oveAccountId, asset.id, { acquiredAt: new Date(Date.now() - 2000) });
      await createHolding(oveAccountId, asset.id, { acquiredAt: new Date(Date.now() - 1000) });
      await createHolding(oveAccountId, asset.id, { acquiredAt: new Date() });

      const page1 = await request(app.getHttpServer())
        .get("/api/v1/me/collectibles?limit=2")
        .set("Cookie", cookie)
        .expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.next_cursor).not.toBeNull();

      const page2 = await request(app.getHttpServer())
        .get(`/api/v1/me/collectibles?limit=2&cursor=${page1.body.next_cursor}`)
        .set("Cookie", cookie)
        .expect(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.next_cursor).toBeNull();
    });

    it("Feature Flag OFFなら503を返す", async () => {
      process.env.ENABLE_DIGITAL_COLLECTION = "false";
      const { cookie } = await loginAsNewUser();
      await request(app.getHttpServer()).get("/api/v1/me/collectibles").set("Cookie", cookie).expect(503);
    });

    it("未ログインなら401", async () => {
      await request(app.getHttpServer()).get("/api/v1/me/collectibles").expect(401);
    });
  });

  describe("GET /api/v1/me/collectibles/:holdingId", () => {
    it("本人のHoldingは詳細を返す (serial_number未設定ならnull、PR#2最終修正P1-4)", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      const asset = await createAsset();
      const holding = await createHolding(oveAccountId, asset.id);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/me/collectibles/${holding.id}`)
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.holding_id).toBe(holding.id);
      expect(res.body.serial_number).toBeNull();
      expect(res.body.asset.asset_code).toBe(asset.assetCode);
    });

    it("serial_numberが付与時に保存されていればそのまま返る (動的算出はしない、PR#2最終修正P1-4)", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      const asset = await createAsset();
      const holding = await createHolding(oveAccountId, asset.id, { serialNumber: "0034" });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/me/collectibles/${holding.id}`)
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.serial_number).toBe("0034");
    });

    it("表示スナップショットが設定されていればAssetより優先される (PR#2最終修正P1-3)", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      const asset = await createAsset({ name: "上杉謙信カード(最新)", imageUrl: "https://example.com/cards/uesugi-v2.png" });
      const holding = await createHolding(oveAccountId, asset.id, {
        displayNameSnapshot: "上杉謙信カード(購入時)",
        imageUrlSnapshot: "https://example.com/cards/uesugi-v1.png",
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/me/collectibles/${holding.id}`)
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.asset.name).toBe("上杉謙信カード(購入時)");
      expect(res.body.asset.image_url).toBe("https://example.com/cards/uesugi-v1.png");
    });

    it("他人のHoldingは404 (存在自体を明かさない)", async () => {
      const me = await loginAsNewUser();
      const other = await loginAsNewUser();
      const asset = await createAsset();
      const holding = await createHolding(other.oveAccountId, asset.id);

      await request(app.getHttpServer())
        .get(`/api/v1/me/collectibles/${holding.id}`)
        .set("Cookie", me.cookie)
        .expect(404);
    });

    it("存在しないholdingIdも404", async () => {
      const { cookie } = await loginAsNewUser();
      await request(app.getHttpServer()).get(`/api/v1/me/collectibles/${generateId()}`).set("Cookie", cookie).expect(404);
    });
  });

  describe("管理画面: カードマスターCRUD", () => {
    it("作成→重複assetCodeで409→更新", async () => {
      const assetCode = `ASSET-ADMIN-${generateId()}`;
      const createRes = await request(app.getHttpServer())
        .post("/api/v1/admin/collectible/assets")
        .set("Cookie", adminCookie)
        .send({ assetCode, name: "武田信玄カード", imageUrl: "https://example.com/cards/takeda.png" })
        .expect(201);
      expect(createRes.body.assetCode).toBe(assetCode);

      await request(app.getHttpServer())
        .post("/api/v1/admin/collectible/assets")
        .set("Cookie", adminCookie)
        .send({ assetCode, name: "重複", imageUrl: "https://example.com/cards/dup.png" })
        .expect(409);

      const updateRes = await request(app.getHttpServer())
        .patch(`/api/v1/admin/collectible/assets/${createRes.body.id}`)
        .set("Cookie", adminCookie)
        .send({ rarity: "SR" })
        .expect(200);
      expect(updateRes.body.rarity).toBe("SR");
    });

    it("HTTP以外・SVG・localhost・private IPの画像URLは400で拒否される (PR#2最終修正P1-2)", async () => {
      const badUrls = [
        "http://example.com/x.png",
        "https://example.com/x.svg",
        "https://localhost/x.png",
        "https://127.0.0.1/x.png",
        "https://10.0.0.5/x.png",
        "https://192.168.1.5/x.png",
        "https://169.254.169.254/x.png",
      ];
      for (const imageUrl of badUrls) {
        await request(app.getHttpServer())
          .post("/api/v1/admin/collectible/assets")
          .set("Cookie", adminCookie)
          .send({ assetCode: `ASSET-BAD-${generateId()}`, name: "x", imageUrl })
          .expect(400);
      }
    });

    it("未認証なら401", async () => {
      await request(app.getHttpServer()).get("/api/v1/admin/collectible/assets").expect(401);
    });

    it("作成・更新のAuditLogが同一トランザクションで記録される (PR#2最終修正P2-1)", async () => {
      const assetCode = `ASSET-AUDIT-${generateId()}`;
      const createRes = await request(app.getHttpServer())
        .post("/api/v1/admin/collectible/assets")
        .set("Cookie", adminCookie)
        .send({ assetCode, name: "毛利元就カード", imageUrl: "https://example.com/cards/mori.png" })
        .expect(201);

      const createdLog = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_ASSET_CREATED", targetId: createRes.body.id },
      });
      expect(createdLog?.result).toBe("SUCCESS");

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/collectible/assets/${createRes.body.id}`)
        .set("Cookie", adminCookie)
        .send({ rarity: "UR" })
        .expect(200);
      const updatedLog = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_ASSET_UPDATED", targetId: createRes.body.id },
      });
      expect(updatedLog).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/collectible/assets/${createRes.body.id}`)
        .set("Cookie", adminCookie)
        .send({ status: "ARCHIVED" })
        .expect(200);
      const archivedLog = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_ASSET_ARCHIVED", targetId: createRes.body.id },
      });
      expect(archivedLog).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/collectible/assets/${createRes.body.id}`)
        .set("Cookie", adminCookie)
        .send({ status: "ACTIVE" })
        .expect(200);
      const activatedLog = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_ASSET_ACTIVATED", targetId: createRes.body.id },
      });
      expect(activatedLog).not.toBeNull();
    });
  });

  describe("管理画面: 保有検索・手動取消", () => {
    it("entitlement_id/product_codeで検索できる", async () => {
      const { oveAccountId } = await loginAsNewUser();
      const asset = await createAsset({ productCode: `PROD-${generateId()}` });
      const holding = await createHolding(oveAccountId, asset.id);

      const byEntitlement = await request(app.getHttpServer())
        .get(`/api/v1/admin/collectible/holdings?entitlement_id=${holding.entitlementId}`)
        .set("Cookie", adminCookie)
        .expect(200);
      expect(byEntitlement.body).toHaveLength(1);
      expect(byEntitlement.body[0].id).toBe(holding.id);

      const byProduct = await request(app.getHttpServer())
        .get(`/api/v1/admin/collectible/holdings?product_code=${asset.productCode}`)
        .set("Cookie", adminCookie)
        .expect(200);
      expect(byProduct.body).toHaveLength(1);
    });

    it("詳細取得: 存在しないIDは404", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/collectible/holdings/${generateId()}`)
        .set("Cookie", adminCookie)
        .expect(404);
    });

    it("手動取消するとACTIVE→REVOKEDになり、AuditLogにactorType ADMINが記録される", async () => {
      const { oveAccountId } = await loginAsNewUser();
      const asset = await createAsset();
      const holding = await createHolding(oveAccountId, asset.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/collectible/holdings/${holding.id}/revoke`)
        .set("Cookie", adminCookie)
        .send({ reason: "問い合わせにより返金" })
        .expect(201);
      expect(res.body.status).toBe("REVOKED");

      const log = await prisma.auditLog.findFirst({
        where: { actionType: "COLLECTIBLE_REVOKED", targetId: holding.id },
        orderBy: { createdAt: "desc" },
      });
      expect(log?.actorType).toBe("ADMIN");
    });
  });
});
