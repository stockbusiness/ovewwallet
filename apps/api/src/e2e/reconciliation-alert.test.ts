import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as Sentry from "@sentry/node";
import { hashSecret } from "@ove/auth";
import { creditWallet } from "@ove/ledger";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

jest.mock("@sentry/node", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * GET /api/v1/admin/reconciliation (指示書17章)。不足機能実装指示書PR-W04 §8.4
 * 「Reconciliation mismatch」対応: 不一致が見つかったらSentryへも通知する
 * (`AdminService.reconcile`)。
 */
describe("GET /api/v1/admin/reconciliation", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-reconcile-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Reconciliation Admin",
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  async function loginAsNewUser(): Promise<{ oveAccountId: string }> {
    const idToken = `mock.${generateId()}`;
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    return { oveAccountId: res.body.ove_account_id };
  }

  // この2テストは注意点あり: `reconcile()`はテストDB内の全ウォレットを走査するため、
  // (a) 自分のウォレット単体の整合性のみを検証対象にし、Sentry呼び出しの有無は他テストの
  // 状態に左右されるため断定しない、(b) 意図的に不一致を作ったウォレットは検証後に
  // 必ず修復し、他のテスト実行を汚染しないようにする。

  it("整合していれば200を返し、自分のウォレットは不一致一覧に含まれない", async () => {
    const { oveAccountId } = await loginAsNewUser();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `reconcile-alert-ok:${wallet.id}`,
      displayName: "整合テスト",
      createdByType: "ADMIN",
    });

    const res = await request(app.getHttpServer()).get("/api/v1/admin/reconciliation").set("Cookie", adminCookie).expect(200);
    const mismatchedCodes: string[] = res.body.mismatched.map((m: { walletCode: string }) => m.walletCode);
    expect(mismatchedCodes).not.toContain(wallet.walletCode);
  });

  it("不一致が見つかるとSentryへ通知する (自動修正はしない)", async () => {
    const { oveAccountId } = await loginAsNewUser();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `reconcile-alert-mismatch:${wallet.id}`,
      displayName: "不一致テスト",
      createdByType: "ADMIN",
    });
    // 台帳を経由しない直接更新で意図的に不一致を発生させる (packages/ledger/src/reconcile.test.tsと同じ手法)。
    await prisma.wallet.update({ where: { id: wallet.id }, data: { availableBalance: 999_999n } });

    try {
      const res = await request(app.getHttpServer()).get("/api/v1/admin/reconciliation").set("Cookie", adminCookie).expect(200);
      const mismatchedCodes: string[] = res.body.mismatched.map((m: { walletCode: string }) => m.walletCode);
      expect(mismatchedCodes).toContain(wallet.walletCode);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(expect.stringContaining(wallet.walletCode), "error");

      // 自動修正しない: 呼び出し直後もDBの値は変わらない。
      const afterCheck = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(afterCheck.availableBalance).toBe(999_999n);
    } finally {
      // 他のテスト実行 (このファイルの再実行含む) を汚染しないよう、意図的に壊した
      // 不一致を必ず修復する。
      await prisma.wallet.update({ where: { id: wallet.id }, data: { availableBalance: 1000n } });
    }
  });

  it("未ログインなら401", async () => {
    await request(app.getHttpServer()).get("/api/v1/admin/reconciliation").expect(401);
  });
});
