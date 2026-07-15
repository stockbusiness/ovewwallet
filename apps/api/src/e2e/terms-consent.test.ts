import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

describe("利用規約同意の永続化", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function requestAndDevCode(server: Parameters<typeof request>[0], email: string): Promise<string> {
    const otpRes = await request(server).post("/api/v1/auth/email/request-otp").send({ email }).expect(201);
    return otpRes.body.devCode;
  }

  it("rejects new-account creation without termsAccepted, and does not create an account", async () => {
    const server = app.getHttpServer();
    const email = `e2e-terms-reject-${generateId()}@example.com`;
    const devCode = await requestAndDevCode(server, email);

    await request(server).post("/api/v1/auth/email/verify-otp").send({ email, code: devCode }).expect(400);

    const account = await prisma.oveAccount.findFirst({ where: { primaryEmail: email } });
    expect(account).toBeNull();
  });

  it("creates the account and persists termsAgreedAt/termsVersion when termsAccepted is true", async () => {
    const server = app.getHttpServer();
    const email = `e2e-terms-accept-${generateId()}@example.com`;
    const devCode = await requestAndDevCode(server, email);

    const verifyRes = await request(server)
      .post("/api/v1/auth/email/verify-otp")
      .send({ email, code: devCode, termsAccepted: true })
      .expect(201);

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: verifyRes.body.ove_account_id } });
    expect(account.termsAgreedAt).not.toBeNull();
    expect(account.termsVersion).toBe("1.0");
  });

  it("does not require re-consent for an existing account's later login", async () => {
    // メールOTPは再送に60秒のクールダウンがあるため、LINEモックログイン (idTokenベース、
    // クールダウンなし) で同一ユーザーの2回目ログインを検証する。
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;

    const firstLogin = await request(server)
      .post("/api/v1/auth/line/login")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    const accountId = firstLogin.body.ove_account_id;

    // 2回目のログインは termsAccepted を送らなくても成功し、同じアカウントに解決される
    const secondLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken }).expect(201);
    expect(secondLogin.body.ove_account_id).toBe(accountId);
  });

  it("rejects a brand-new LINE account without termsAccepted", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    await request(server).post("/api/v1/auth/line/login").send({ idToken }).expect(400);
  });
});
