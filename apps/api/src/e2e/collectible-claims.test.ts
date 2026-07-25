import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { sha256Hex } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * NFTカードClaim導線実装指示書16章。戦国マーケットのClaim APIを模したローカルHTTP
 * サーバーへ`SENGOKU_MARKET_CLAIM_BASE_URL`を向け、サーバー間呼び出しを検証する。
 * トークン文字列自体にシナリオを埋め込む (例: "notfound-..."は404、"revoked-..."は
 * confirm時409+code:revoked) ことで、実際の戦国マーケットの実装なしに全パターンを再現する。
 */
describe("NFTカードClaim導線 (実装指示書)", () => {
  let app: INestApplication;
  let marketServer: http.Server;
  let receivedHeaders: Record<string, string>[] = [];

  beforeAll(async () => {
    marketServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedHeaders.push(req.headers as Record<string, string>);
        const url = req.url ?? "";

        if (req.method === "GET") {
          if (url.includes("notfound-token")) return json(res, 404, { code: "not_found" });
          if (url.includes("expired-token")) return json(res, 410, { code: "expired" });
          if (url.includes("delivered-token")) return json(res, 200, { status: "DELIVERED", card_name: "織田信長 SSR" });
          if (url.includes("pending-token")) return json(res, 200, { status: "PENDING", card_name: "織田信長 SSR" });
          return json(res, 200, { status: "PENDING", card_name: "テストカード" });
        }

        // POST .../confirm
        if (url.includes("revoked-token")) return json(res, 409, { code: "revoked" });
        if (url.includes("mismatch-token")) return json(res, 409, { code: "common_user_mismatch" });
        if (url.includes("processing-token")) return json(res, 409, { code: "processing" });
        if (url.includes("notfound-token")) return json(res, 404, { code: "not_found" });
        return json(res, 202, { status: "DELIVERY_PENDING" });
      });
    });
    await new Promise<void>((resolve) => marketServer.listen(0, "127.0.0.1", resolve));
    const { port } = marketServer.address() as AddressInfo;

    process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
    process.env.SENGOKU_MARKET_CLAIM_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.SENGOKU_MARKET_CLAIM_KEY_ID = "test-claim-key";
    process.env.SENGOKU_MARKET_CLAIM_HMAC_SECRET = "test-claim-secret";

    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => marketServer.close(() => resolve()));
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
    receivedHeaders = [];
  });

  function json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  async function loginAsNewUser(): Promise<{ cookie: string[]; oveAccountId: string }> {
    const idToken = `mock.${generateId()}`;
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    return { cookie: res.headers["set-cookie"] as unknown as string[], oveAccountId: res.body.ove_account_id };
  }

  async function setCommonUserId(oveAccountId: string, commonUserId: string): Promise<void> {
    await prisma.oveAccount.update({ where: { id: oveAccountId }, data: { commonUserId } });
  }

  describe("GET /api/v1/collectible-claims/:token (指示書8章)", () => {
    it("未ログインでも呼び出せ、個人情報を含まない概要を返す", async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/collectible-claims/pending-token-${generateId()}`).expect(200);
      expect(res.body.status).toBe("PENDING");
      expect(res.body.card_name).toBe("織田信長 SSR");
      expect(res.body.requires_login).toBe(true);
      expect(res.body.claim_session_id).toBeDefined();
      // 個人情報 (氏名/メール/注文金額/common_user_id/ove_account_id) を含まない。
      expect(res.body.common_user_id).toBeUndefined();
      expect(res.body.ove_account_id).toBeUndefined();
    });

    it("ログイン済みならrequires_login=falseになる", async () => {
      const { cookie } = await loginAsNewUser();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/collectible-claims/pending-token-${generateId()}`)
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.requires_login).toBe(false);
    });

    it("マーケットが404を返せば404 not_foundになる", async () => {
      await request(app.getHttpServer()).get(`/api/v1/collectible-claims/notfound-token-${generateId()}`).expect(404);
    });

    it("マーケットが410を返せば410 expiredになる", async () => {
      await request(app.getHttpServer()).get(`/api/v1/collectible-claims/expired-token-${generateId()}`).expect(410);
    });

    it("Feature Flag OFFなら503を返す", async () => {
      process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "false";
      await request(app.getHttpServer()).get(`/api/v1/collectible-claims/pending-token-${generateId()}`).expect(503);
    });

    it("Claim Session Cookieを HttpOnly/Secure/SameSite=Lax で発行する", async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/collectible-claims/pending-token-${generateId()}`).expect(200);
      const setCookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("claim_session="));
      expect(setCookie).toBeDefined();
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
    });

    it("Referrer-PolicyとCache-Controlヘッダーを設定する (指示書13章)", async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/collectible-claims/pending-token-${generateId()}`).expect(200);
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("同じ生Tokenで再訪問しても同じclaim_session_idが返る (Claim Session再利用)", async () => {
      const token = `pending-token-${generateId()}`;
      const first = await request(app.getHttpServer()).get(`/api/v1/collectible-claims/${token}`).expect(200);
      const second = await request(app.getHttpServer()).get(`/api/v1/collectible-claims/${token}`).expect(200);
      expect(second.body.claim_session_id).toBe(first.body.claim_session_id);
    });

    it("claim_session_idそのものでも同じ概要を取得できる (ログイン復帰後の安全なReturn Path用)", async () => {
      const token = `pending-token-${generateId()}`;
      const first = await request(app.getHttpServer()).get(`/api/v1/collectible-claims/${token}`).expect(200);
      const bySessionId = await request(app.getHttpServer())
        .get(`/api/v1/collectible-claims/${first.body.claim_session_id}`)
        .expect(200);
      expect(bySessionId.body.claim_session_id).toBe(first.body.claim_session_id);
    });
  });

  describe("POST /api/v1/collectible-claims/:token/confirm (指示書9・11章)", () => {
    it("未ログインなら401", async () => {
      await request(app.getHttpServer()).post(`/api/v1/collectible-claims/pending-token-${generateId()}/confirm`).expect(401);
    });

    it("common_user_id未解決なら202 common_user_unresolvedを返しMarketを呼ばない", async () => {
      const { cookie } = await loginAsNewUser();
      const token = `pending-token-${generateId()}`;
      const before = receivedHeaders.length;
      const res = await request(app.getHttpServer())
        .post(`/api/v1/collectible-claims/${token}/confirm`)
        .set("Cookie", cookie)
        .expect(202);
      expect(res.body.status).toBe("common_user_unresolved");
      // POST(confirm)はMarketへ到達していない (GETの概要取得すら行っていない)。
      expect(receivedHeaders.length).toBe(before);
    });

    it("正常系: common_user_id解決済みなら202 DELIVERY_PENDINGを返す (ブラウザからaccount_id/common_user_idは送らない)", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);
      const token = `ok-token-${generateId()}`;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/collectible-claims/${token}/confirm`)
        .set("Cookie", cookie)
        .send({}) // ove_account_id/common_user_idはbodyに含めない
        .expect(202);
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe("DELIVERY_PENDING");

      const sentHeaders = receivedHeaders[receivedHeaders.length - 1]!;
      expect(sentHeaders["x-sennokuni-key-id"]).toBe("test-claim-key");
      expect(sentHeaders["x-sennokuni-signature"]).toBeDefined();
      expect(sentHeaders["idempotency-key"]).toMatch(/^wallet-claim-confirm:/);
    });

    it("マーケットのrevokedは409を返す", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/collectible-claims/revoked-token-${generateId()}/confirm`)
        .set("Cookie", cookie)
        .expect(409);
      expect(res.body.error).toBe("revoked");
    });

    it("マーケットのcommon_user_mismatchは409を返す", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/collectible-claims/mismatch-token-${generateId()}/confirm`)
        .set("Cookie", cookie)
        .expect(409);
      expect(res.body.error).toBe("common_user_mismatch");
    });

    it("マーケットのprocessingは409を返す", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);
      await request(app.getHttpServer())
        .post(`/api/v1/collectible-claims/processing-token-${generateId()}/confirm`)
        .set("Cookie", cookie)
        .expect(409);
    });

    it("マーケットのnot_foundは404を返す", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);
      await request(app.getHttpServer())
        .post(`/api/v1/collectible-claims/notfound-token-${generateId()}/confirm`)
        .set("Cookie", cookie)
        .expect(404);
    });

    it("同一ユーザー・同一Claim Sessionの再実行は同じIdempotency-Keyになる", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);
      const token = `ok-token-${generateId()}`;

      await request(app.getHttpServer()).post(`/api/v1/collectible-claims/${token}/confirm`).set("Cookie", cookie).expect(202);
      await request(app.getHttpServer()).post(`/api/v1/collectible-claims/${token}/confirm`).set("Cookie", cookie).expect(202);

      const keys = receivedHeaders.slice(-2).map((h) => h["idempotency-key"]);
      expect(keys[0]).toBe(keys[1]);
    });

    it("Feature Flag OFFなら503を返し、Claim Session行を作らない", async () => {
      process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "false";
      const { cookie, oveAccountId } = await loginAsNewUser();
      process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);
      process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "false";

      const token = `flagoff-token-${generateId()}`;
      await request(app.getHttpServer()).post(`/api/v1/collectible-claims/${token}/confirm`).set("Cookie", cookie).expect(503);

      const created = await prisma.claimSession.findUnique({ where: { tokenHash: sha256Hex(token) } });
      expect(created).toBeNull();
    });

    it("AuditLogにClaim Token本体を記録せず、Claim Session IDのみ記録する", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);
      const token = `ok-token-${generateId()}`;

      await request(app.getHttpServer()).post(`/api/v1/collectible-claims/${token}/confirm`).set("Cookie", cookie).expect(202);

      const logs = await prisma.auditLog.findMany({
        where: { actionType: { in: ["COLLECTIBLE_CLAIM_CONFIRM_REQUESTED", "COLLECTIBLE_CLAIM_CONFIRM_ACCEPTED"] } },
        orderBy: { createdAt: "desc" },
        take: 2,
      });
      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) {
        expect(log.targetId).not.toBe(token);
        expect(JSON.stringify(log)).not.toContain(token);
      }
    });

    // このファイル内の他のconfirmテストと同じThrottlerストレージを共有するため、
    // 429を実際に発生させる本テストは最後に置く (以降のテストへ影響させないため)。
    it("rate limitを超えると429になる (指示書13章 Confirm rate limit)", async () => {
      const { cookie, oveAccountId } = await loginAsNewUser();
      await setCommonUserId(oveAccountId, `cu_${generateId()}`);

      let sawTooManyRequests = false;
      for (let i = 0; i < 25; i++) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/collectible-claims/ratelimit-token-${generateId()}/confirm`)
          .set("Cookie", cookie);
        if (res.status === 429) {
          sawTooManyRequests = true;
          break;
        }
      }
      expect(sawTooManyRequests).toBe(true);
    });
  });
});
