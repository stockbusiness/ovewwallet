import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 次期改修指示書P0-7: 開発用戦国パスポートSSOコード発行 (`POST
 * /api/v1/auth/sso/sengoku/dev-issue`) は、正式SSO (RS256/JWKS) が完成するまで
 * 本番 (NODE_ENV=production) で無効化する。
 */
describe("POST /api/v1/auth/sso/sengoku/dev-issue (次期改修指示書P0-7)", () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("issues a mock code outside production", async () => {
    process.env.NODE_ENV = "test";
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/sso/sengoku/dev-issue")
      .send({ sengokuMemberId: `member-${generateId()}` })
      .expect(201);
    expect(res.body.code).toBeTruthy();
  });

  it("returns 404 when NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    await request(app.getHttpServer())
      .post("/api/v1/auth/sso/sengoku/dev-issue")
      .send({ sengokuMemberId: `member-${generateId()}` })
      .expect(404);
  });
});
