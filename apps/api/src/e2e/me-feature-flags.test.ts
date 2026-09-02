import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * ウォレット画面の導線をFeature Flagで出し分けるための GET /api/v1/me/feature-flags。
 *
 * 連携サービス一覧 (`/wallet/services`) は稼働開始時点で全件「未連携」かつサービス名も
 * 未確定のため、`ENABLE_LINKED_SERVICES` で隠している。フロントエンドはこのエンドポイントの
 * 応答だけを見て導線を出し分けるので、既定でOFFになっていることをここで担保する。
 */
describe("画面導線のFeature Flag (GET /api/v1/me/feature-flags)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function loginCookie(): Promise<string[]> {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
      .expect(201);
    return login.headers["set-cookie"] as unknown as string[];
  }

  it("未設定なら linked_services_enabled は false (既定OFF)", async () => {
    const cookie = await loginCookie();
    const res = await request(app.getHttpServer())
      .get("/api/v1/me/feature-flags")
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body.linked_services_enabled).toBe(false);
  });

  it("ENABLE_LINKED_SERVICES=true のときだけ true になる", async () => {
    const cookie = await loginCookie();
    const previous = process.env.ENABLE_LINKED_SERVICES;
    process.env.ENABLE_LINKED_SERVICES = "true";
    try {
      const res = await request(app.getHttpServer())
        .get("/api/v1/me/feature-flags")
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.linked_services_enabled).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ENABLE_LINKED_SERVICES;
      else process.env.ENABLE_LINKED_SERVICES = previous;
    }
  });

  it('"true" 以外の値はすべてOFF扱いになる (安全側デフォルト)', async () => {
    const cookie = await loginCookie();
    const previous = process.env.ENABLE_LINKED_SERVICES;
    try {
      for (const value of ["1", "TRUE", "yes", "", "false"]) {
        process.env.ENABLE_LINKED_SERVICES = value;
        const res = await request(app.getHttpServer())
          .get("/api/v1/me/feature-flags")
          .set("Cookie", cookie)
          .expect(200);
        expect(res.body.linked_services_enabled).toBe(false);
      }
    } finally {
      if (previous === undefined) delete process.env.ENABLE_LINKED_SERVICES;
      else process.env.ENABLE_LINKED_SERVICES = previous;
    }
  });

  it("未ログインでは401 (導線の出し分けもセッション前提)", async () => {
    await request(app.getHttpServer()).get("/api/v1/me/feature-flags").expect(401);
  });
});
