import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 完成条件 (指示書22章) のゴールデンパスを自動テストとして固定する:
 * アカウント作成 -> 1アカウント1ウォレット -> 管理者付与 -> 残高確認 -> 履歴確認 -> 利用 -> 残高不足拒否
 */
describe("golden path (E2E)", () => {
  let app: INestApplication;
  let adminEmail: string;
  let adminPassword: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    adminEmail = `e2e-admin-${generateId()}@ovewallet.local`;
    adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Test Admin",
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("walks the full golden path", async () => {
    const server = app.getHttpServer();
    const email = `e2e-user-${generateId()}@example.com`;

    const otpRes = await request(server)
      .post("/api/v1/auth/email/request-otp")
      .send({ email })
      .expect(201);
    const devCode: string = otpRes.body.devCode;
    expect(devCode).toMatch(/^\d{6}$/);

    const verifyRes = await request(server)
      .post("/api/v1/auth/email/verify-otp")
      .send({ email, code: devCode })
      .expect(201);
    const oveAccountId: string = verifyRes.body.ove_account_id;
    const sessionCookie = verifyRes.headers["set-cookie"] as unknown as string[];
    expect(oveAccountId).toBeTruthy();

    // 1アカウント1ウォレットが自動作成されている
    const balance0 = await request(server)
      .get(`/api/v1/wallets/${oveAccountId}/balance`)
      .expect(200);
    expect(balance0.body.available_balance).toBe("0");
    const walletId: string = balance0.body.wallet_id;

    // 管理者ログイン
    const adminLoginRes = await request(server)
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    const adminCookie = adminLoginRes.headers["set-cookie"] as unknown as string[];

    // 管理者からOVEを付与できる
    await request(server)
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId, amount: 3000, reason: "E2Eテスト付与" })
      .expect(201);

    // ユーザーが残高を確認できる
    const balance1 = await request(server)
      .get(`/api/v1/wallets/${oveAccountId}/balance`)
      .expect(200);
    expect(balance1.body.available_balance).toBe("3000");

    // 取引履歴を確認できる
    const historyRes = await request(server)
      .get(`/api/v1/wallets/${oveAccountId}/transactions`)
      .expect(200);
    expect(historyRes.body).toHaveLength(1);
    expect(historyRes.body[0].transaction_type).toBe("ADMIN_GRANT");

    // 残高不足時は拒否される (減算APIは外部サービス認証が必要なため、管理者減算で確認)。
    // 金額はHIGH_VALUE_THRESHOLD (二段階承認の対象) 未満かつ残高 (3000) 超過にする。
    await request(server)
      .post("/api/v1/admin/wallets/deduct")
      .set("Cookie", adminCookie)
      .send({ walletId, amount: 40000, reason: "残高超過テスト" })
      .expect(409);

    const balanceUnchanged = await request(server)
      .get(`/api/v1/wallets/${oveAccountId}/balance`)
      .expect(200);
    expect(balanceUnchanged.body.available_balance).toBe("3000"); // 変化なし

    // OVEを利用できる (管理者減算で確認)
    await request(server)
      .post("/api/v1/admin/wallets/deduct")
      .set("Cookie", adminCookie)
      .send({ walletId, amount: 1000, reason: "利用テスト" })
      .expect(201);

    const balanceFinal = await request(server)
      .get(`/api/v1/wallets/${oveAccountId}/balance`)
      .expect(200);
    expect(balanceFinal.body.available_balance).toBe("2000");

    // ログアウト
    await request(server).post("/api/v1/auth/logout").set("Cookie", sessionCookie).expect(201);
  });
});
