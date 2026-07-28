import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/** ログインデバイス一覧 (docs/login-devices.md参照)。 */
describe("ログインデバイス一覧", () => {
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

  it("2台からログインすると2件返り、それぞれ is_current が正しく判定される", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;

    const loginA = await request(server)
      .post("/api/v1/auth/line/login")
      .set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    const cookieA = loginA.headers["set-cookie"] as unknown as string[];

    const loginB = await request(server)
      .post("/api/v1/auth/line/login")
      .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    const cookieB = loginB.headers["set-cookie"] as unknown as string[];

    const listFromA = await request(server).get("/api/v1/accounts/me/sessions").set("Cookie", cookieA).expect(200);
    expect(listFromA.body).toHaveLength(2);
    const currentInA = listFromA.body.find((s: { is_current: boolean }) => s.is_current);
    expect(currentInA.device_label).toBe("iPhone / Safari");

    const listFromB = await request(server).get("/api/v1/accounts/me/sessions").set("Cookie", cookieB).expect(200);
    const currentInB = listFromB.body.find((s: { is_current: boolean }) => s.is_current);
    expect(currentInB.device_label).toBe("Windows / Chrome");
  });

  it("自分のセッションを個別に無効化でき、以後そのCookieでは認証できなくなる", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;

    const loginA = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookieA = loginA.headers["set-cookie"] as unknown as string[];
    const loginB = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookieB = loginB.headers["set-cookie"] as unknown as string[];

    const listFromA = await request(server).get("/api/v1/accounts/me/sessions").set("Cookie", cookieA).expect(200);
    const otherSession = listFromA.body.find((s: { is_current: boolean }) => !s.is_current);
    expect(otherSession).toBeDefined();

    await request(server).post(`/api/v1/accounts/me/sessions/${otherSession.id}/revoke`).set("Cookie", cookieA).expect(201);

    // B側のセッションは無効化済みのため、Bのcookieではもう認証できない。
    await request(server).get("/api/v1/me/wallet").set("Cookie", cookieB).expect(401);
    // Aのセッションは無事のまま。
    await request(server).get("/api/v1/me/wallet").set("Cookie", cookieA).expect(200);
  });

  it("他人のセッションIDを指定しても404になる", async () => {
    const server = app.getHttpServer();

    const idTokenA = `mock.${generateId()}`;
    const loginA = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenA, termsAccepted: true }).expect(201);
    const cookieA = loginA.headers["set-cookie"] as unknown as string[];

    const idTokenB = `mock.${generateId()}`;
    const loginB = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenB, termsAccepted: true }).expect(201);
    const cookieB = loginB.headers["set-cookie"] as unknown as string[];

    const listFromB = await request(server).get("/api/v1/accounts/me/sessions").set("Cookie", cookieB).expect(200);
    const bSessionId = listFromB.body[0].id;

    await request(server).post(`/api/v1/accounts/me/sessions/${bSessionId}/revoke`).set("Cookie", cookieA).expect(404);
  });

  it("この端末以外からすべてログアウトすると、現在のセッションだけ残る", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;

    const loginA = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookieA = loginA.headers["set-cookie"] as unknown as string[];
    const loginB = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookieB = loginB.headers["set-cookie"] as unknown as string[];
    const loginC = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookieC = loginC.headers["set-cookie"] as unknown as string[];

    const res = await request(server).post("/api/v1/accounts/me/sessions/revoke-others").set("Cookie", cookieA).expect(201);
    expect(res.body.revoked_count).toBe(2);

    // B・Cは無効化されたため以後認証できない。Aは無事のまま。
    await request(server).get("/api/v1/me/wallet").set("Cookie", cookieB).expect(401);
    await request(server).get("/api/v1/me/wallet").set("Cookie", cookieC).expect(401);
    await request(server).get("/api/v1/me/wallet").set("Cookie", cookieA).expect(200);

    const listFromA = await request(server).get("/api/v1/accounts/me/sessions").set("Cookie", cookieA).expect(200);
    expect(listFromA.body).toHaveLength(1);
    expect(listFromA.body[0].is_current).toBe(true);
  });
});
