import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { AccountClosureService } from "../accounts/account-closure.service";

/** ユーザー本人による退会 (docs/account-closure.md参照)。 */
describe("退会 (POST /api/v1/accounts/me/close)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-closure-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Closure Admin",
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

  it("残高が残っている場合は400で拒否する", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const cookie = login.headers["set-cookie"] as unknown as string[];

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: login.body.ove_account_id } });
    await request(server)
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId: wallet.id, amount: 1000, reason: "e2e grant" })
      .expect(201);

    await request(server).post("/api/v1/accounts/me/close").set("Cookie", cookie).expect(400);

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: login.body.ove_account_id } });
    expect(account.status).toBe("ACTIVE");
  });

  it("残高0なら退会でき、以後そのCookieでは認証できず、同じLINEユーザーIDで再ログインもできない", async () => {
    const server = app.getHttpServer();
    const lineUserId = `e2e-closure-${generateId()}`;
    const login = await request(server)
      .post("/api/v1/auth/line/login")
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(201);
    const cookie = login.headers["set-cookie"] as unknown as string[];

    const closeRes = await request(server).post("/api/v1/accounts/me/close").set("Cookie", cookie).expect(201);
    expect(closeRes.body).toEqual({ closed: true });

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: login.body.ove_account_id } });
    expect(account.status).toBe("CLOSED");
    expect(account.closedAt).not.toBeNull();

    // 退会済みアカウントのセッションは失効しているため、既存Cookieでは認証できない。
    await request(server).get("/api/v1/me/wallet").set("Cookie", cookie).expect(401);

    // 同じLINEユーザーIDで再ログインしようとしても拒否される (再登録の抜け道を作らない)。
    await request(server)
      .post("/api/v1/auth/line/login")
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(403);
  });

  it("既に退会済みのアカウントで再度退会しようとすると409 (サービス層を直接検証)", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const oveAccountId = login.body.ove_account_id as string;

    // 通常はUIから到達不能 (退会に成功すると自分のセッションも即座に失効するため、
    // HTTP経由で「退会済みアカウントに対する退会リクエスト」は再現できない)。
    // サーバー側の冪等性ガード自体はサービス層で直接検証する。
    const closure = new AccountClosureService(prisma);
    await closure.requestClosure(oveAccountId);
    await expect(closure.requestClosure(oveAccountId)).rejects.toThrow(/already closed/);
  });
});
