import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * メンテナンスモードが実際のアプリに組み込まれていることの確認。
 *
 * 分岐そのものは`common/maintenance-mode.middleware.test.ts`で検証済み。ここでは
 * ミドルウェアがAppModuleに登録され、本物のリクエスト経路で効くことを確かめる
 * (登録漏れは単体テストでは絶対に見つからない)。
 */
describe("メンテナンスモード", () => {
  let app: INestApplication;
  let cookie: string[];
  const original = process.env.MAINTENANCE_MODE;

  beforeAll(async () => {
    delete process.env.MAINTENANCE_MODE; // 準備中は通常動作させる
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
      .expect(201);
    cookie = login.headers["set-cookie"] as unknown as string[];
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = original;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("readonly: 閲覧は通り、更新系は503になる", async () => {
    const server = app.getHttpServer();
    process.env.MAINTENANCE_MODE = "readonly";

    await request(server).get("/api/v1/me/wallet").set("Cookie", cookie).expect(200);

    const blocked = await request(server)
      .post("/api/v1/me/wallet/daily-bonus")
      .set("Cookie", cookie)
      .expect(503);
    expect(blocked.body.maintenance).toBe(true);
    expect(blocked.headers["retry-after"]).toBe("300");
  });

  it("full: 閲覧も503になるが、ヘルスチェックは通る", async () => {
    const server = app.getHttpServer();
    process.env.MAINTENANCE_MODE = "full";

    await request(server).get("/api/v1/me/wallet").set("Cookie", cookie).expect(503);

    // ここを止めるとオーケストレータがコンテナを再起動し続けてしまう
    await request(server).get("/health").expect(200);
  });

  it("off に戻せば通常どおり動く", async () => {
    delete process.env.MAINTENANCE_MODE;
    await request(app.getHttpServer()).get("/api/v1/me/wallet").set("Cookie", cookie).expect(200);
  });
});
