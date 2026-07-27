import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * ログイン系エンドポイントはパスワード/コードの総当たり対策として、
 * 全体既定 (60秒120回) より厳しい60秒10回のレート制限を課している (`docs/security.md` 参照)。
 */
describe("ログイン系エンドポイントのレート制限 (開発ガイドライン: レート制限値の見直し)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 429 after 10 requests to admin login within the window", async () => {
    let sawTooManyRequests = false;
    for (let i = 0; i < 12; i++) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/login")
        .send({ email: "nonexistent-admin@ovewallet.local", password: "wrong-password" });
      if (res.status === 429) {
        sawTooManyRequests = true;
        break;
      }
      expect(res.status).toBe(401); // 存在しない管理者なので通常は401
    }
    expect(sawTooManyRequests).toBe(true);
  });

  it("returns 429 after 10 requests to email OTP verification within the window", async () => {
    let sawTooManyRequests = false;
    for (let i = 0; i < 12; i++) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .send({ email: "nonexistent-user@ovewallet.local", code: "000000" });
      if (res.status === 429) {
        sawTooManyRequests = true;
        break;
      }
      expect(res.status).toBe(401); // OTP未発行なので通常は401
    }
    expect(sawTooManyRequests).toBe(true);
  });
});
