import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 利用できるログイン方法の出し分け (docs/login-methods.md)。
 *
 * 稼働開始時点で使えるのはLINEログインだけ。メールOTPは**送信基盤が未実装**で、
 * 千ノ国パスポートSSOは正式SSOが未完成、代理店SSOは未接続。画面から隠すだけでなく
 * サーバー側でも拒否する。
 */
describe("利用できるログイン方法", () => {
  let app: INestApplication;
  const KEYS = ["ENABLE_EMAIL_LOGIN", "ENABLE_SENGOKU_PASSPORT_LOGIN", "ENABLE_AGENCY_LOGIN"] as const;
  const original = new Map(KEYS.map((k) => [k, process.env[k]]));

  /** 本番と同じ「LINEのみ」の状態にする。テスト環境は`.env.test`で全て有効にしてあるため。 */
  function disableAllButLine() {
    for (const key of KEYS) delete process.env[key];
  }

  function restoreEnv() {
    for (const key of KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterEach(restoreEnv);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("GET /api/v1/auth/methods", () => {
    it("未ログインで参照でき、既定ではLINEのみ有効", async () => {
      disableAllButLine();
      const res = await request(app.getHttpServer()).get("/api/v1/auth/methods").expect(200);
      expect(res.body).toEqual({
        line: true,
        email: false,
        sengoku_passport: false,
        agency: false,
      });
    });

    it("環境変数で有効化すると反映される (メール送信基盤ができたとき用)", async () => {
      process.env.ENABLE_EMAIL_LOGIN = "true";
      const res = await request(app.getHttpServer()).get("/api/v1/auth/methods").expect(200);
      expect(res.body.email).toBe(true);
    });
  });

  describe("無効なログイン方法はサーバーが拒否する", () => {
    beforeEach(disableAllButLine);

    // 画面から隠すだけでは、APIを直接叩けば動かない経路に入れてしまう
    it("メールOTPの発行・検証は404", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/email/request-otp")
        .send({ email: `login-methods-${generateId()}@example.com` })
        .expect(404);

      await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .send({ email: `login-methods-${generateId()}@example.com`, code: "000000" })
        .expect(404);
    });

    it("千ノ国パスポートSSOのコード交換は404", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/sso/sengoku/exchange")
        .send({ code: "dummy-code" })
        .expect(404);
    });

    it("代理店SSOは404", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/sso/agency")
        .send({ token: "dummy.jwt.token" })
        .expect(404);
    });
  });

  describe("LINEログインは使える", () => {
    it("既定で有効なので、従来どおりログインできる", async () => {
      // 唯一使えるログイン方法。設定漏れで塞がると誰も入れなくなるため既定で有効
      await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
        .expect(201);
    });
  });

  describe("有効化すれば元の挙動に戻る", () => {
    it("メールOTPを有効化すると発行できる", async () => {
      process.env.ENABLE_EMAIL_LOGIN = "true";
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/email/request-otp")
        .send({ email: `login-methods-enabled-${generateId()}@example.com` })
        .expect(201);
      // NODE_ENVが本番以外のときだけコードが返る (本番では届く手段が無い)
      expect(res.body.devCode).toBeDefined();
    });
  });
});
