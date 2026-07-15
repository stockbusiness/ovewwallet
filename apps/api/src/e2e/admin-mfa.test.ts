import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { computeTotpCode, hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

describe("管理画面MFA (指示書13章)", () => {
  let app: INestApplication;
  let email: string;
  const password = "e2e-test-password-123";

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    email = `e2e-mfa-admin-${generateId()}@ovewallet.local`;
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "E2E MFA Admin",
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("logs in without MFA before setup, and setup/enable/login/disable all work end-to-end", async () => {
    const server = app.getHttpServer();

    // 1. MFA未設定の状態では通常通りログインできる
    const initialLogin = await request(server).post("/api/v1/admin/login").send({ email, password }).expect(201);
    expect(initialLogin.body).toEqual({ success: true, mfaRequired: false });
    const initialCookie = initialLogin.headers["set-cookie"] as unknown as string[];
    expect(initialCookie?.[0]).toContain("ove_admin_session");

    // 2. MFAセットアップ開始 (この時点ではまだ mfaEnabled=false)
    const setupRes = await request(server)
      .post("/api/v1/admin/mfa/setup")
      .set("Cookie", initialCookie)
      .expect(201);
    const { secret, otpauthUri } = setupRes.body;
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const meBeforeEnable = await request(server).get("/api/v1/admin/me").set("Cookie", initialCookie).expect(200);
    expect(meBeforeEnable.body.mfaEnabled).toBe(false);

    // 3. 間違ったコードでの有効化は拒否される
    await request(server)
      .post("/api/v1/admin/mfa/enable")
      .set("Cookie", initialCookie)
      .send({ code: "000000" })
      .expect(401);

    // 4. 正しいコードで有効化
    const validCode = computeTotpCode(secret);
    await request(server).post("/api/v1/admin/mfa/enable").set("Cookie", initialCookie).send({ code: validCode }).expect(201);

    const meAfterEnable = await request(server).get("/api/v1/admin/me").set("Cookie", initialCookie).expect(200);
    expect(meAfterEnable.body.mfaEnabled).toBe(true);

    // 5. MFA有効化後のログインはセッションを即発行せず mfaToken を返す
    const mfaLoginAttempt = await request(server).post("/api/v1/admin/login").send({ email, password }).expect(201);
    expect(mfaLoginAttempt.body.mfaRequired).toBe(true);
    expect(mfaLoginAttempt.headers["set-cookie"]).toBeUndefined();
    const mfaToken: string = mfaLoginAttempt.body.mfaToken;
    expect(mfaToken).toBeTruthy();

    // 6. 間違ったMFAコードでは2段階目が拒否される
    await request(server).post("/api/v1/admin/login/mfa").send({ mfaToken, code: "000000" }).expect(401);

    // 7. 正しいMFAコードでセッションが発行される
    const mfaCompleteRes = await request(server)
      .post("/api/v1/admin/login/mfa")
      .send({ mfaToken, code: computeTotpCode(secret) })
      .expect(201);
    const mfaSessionCookie = mfaCompleteRes.headers["set-cookie"] as unknown as string[];
    expect(mfaSessionCookie?.[0]).toContain("ove_admin_session");
    await request(server).get("/api/v1/admin/me").set("Cookie", mfaSessionCookie).expect(200);

    // 8. 使い切った mfaToken は再利用できない (使い捨て)
    await request(server)
      .post("/api/v1/admin/login/mfa")
      .send({ mfaToken, code: computeTotpCode(secret) })
      .expect(401);

    // 9. 無効化: パスワード誤りは拒否
    await request(server)
      .post("/api/v1/admin/mfa/disable")
      .set("Cookie", mfaSessionCookie)
      .send({ password: "wrong-password", code: computeTotpCode(secret) })
      .expect(401);

    // 10. 正しいパスワード+コードで無効化
    await request(server)
      .post("/api/v1/admin/mfa/disable")
      .set("Cookie", mfaSessionCookie)
      .send({ password, code: computeTotpCode(secret) })
      .expect(201);

    // 11. 無効化後は通常ログインに戻る
    const finalLogin = await request(server).post("/api/v1/admin/login").send({ email, password }).expect(201);
    expect(finalLogin.body).toEqual({ success: true, mfaRequired: false });
  });

  it("rejects an unknown or expired mfaToken", async () => {
    const server = app.getHttpServer();
    await request(server).post("/api/v1/admin/login/mfa").send({ mfaToken: "not-a-real-token", code: "123456" }).expect(401);
  });
});
