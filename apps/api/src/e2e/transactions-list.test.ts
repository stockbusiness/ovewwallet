import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  prisma,
  generateId,
  nextDisplayCode,
  ACCOUNT_CODE_COUNTER,
  WALLET_CODE_COUNTER,
} from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

describe("admin transaction list + reverse (指示書13章)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let accountCode: string;
  let walletId: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-txnlist-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Transactions Admin",
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = loginRes.headers["set-cookie"] as unknown as string[];

    accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const account = await prisma.oveAccount.create({ data: { id: generateId(), accountCode, status: "ACTIVE" } });
    const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
    const wallet = await prisma.wallet.create({
      data: { id: generateId(), oveAccountId: account.id, walletCode, status: "ACTIVE" },
    });
    walletId = wallet.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("lists transactions filtered by accountCode/status/direction, and reverse works from the list", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId, amount: 2000, reason: "取引一覧テスト用付与" })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/transactions?accountCode=${accountCode}`)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].account_code).toBe(accountCode);
    expect(listRes.body[0].direction).toBe("CREDIT");
    const transactionId = listRes.body[0].id;

    const filteredByDirection = await request(app.getHttpServer())
      .get(`/api/v1/admin/transactions?accountCode=${accountCode}&direction=DEBIT`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(filteredByDirection.body).toHaveLength(0); // まだDEBITはない

    await request(app.getHttpServer())
      .post(`/api/v1/admin/transactions/${transactionId}/reverse`)
      .set("Cookie", adminCookie)
      .send({ reason: "取引一覧画面からの取消テスト" })
      .expect(201);

    const listAfterReverse = await request(app.getHttpServer())
      .get(`/api/v1/admin/transactions?accountCode=${accountCode}`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(listAfterReverse.body).toHaveLength(2); // 元取引(REVERSED) + REVERSAL取引
    const statuses = listAfterReverse.body.map((t: { status: string }) => t.status).sort();
    expect(statuses).toEqual(["COMPLETED", "REVERSED"]);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.availableBalance.toString()).toBe("0"); // 取消で残高が戻る
  });

  it("returns an empty list for an unknown accountCode instead of erroring", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/admin/transactions?accountCode=OVE-ACC-99999999")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});
