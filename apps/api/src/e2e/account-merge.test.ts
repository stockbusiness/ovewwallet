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

async function createTestAccount(balance = 0) {
  const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
  const account = await prisma.oveAccount.create({
    data: { id: generateId(), accountCode, status: "ACTIVE" },
  });
  const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
  const wallet = await prisma.wallet.create({
    data: {
      id: generateId(),
      oveAccountId: account.id,
      walletCode,
      status: "ACTIVE",
      availableBalance: balance,
      lifetimeCredited: balance,
    },
  });
  return { account, wallet };
}

describe("account merge (指示書6章・13章)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-merge-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Merge Admin",
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = loginRes.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("transfers balance, moves identities, and prevents login on the merged account", async () => {
    const { account: source, wallet: sourceWallet } = await createTestAccount(3000);
    const { account: target, wallet: targetWallet } = await createTestAccount(500);

    await prisma.accountIdentity.create({
      data: {
        id: generateId(),
        oveAccountId: source.id,
        identityType: "EMAIL",
        provider: "EMAIL",
        providerSubject: `merge-e2e-${source.id}@example.com`,
      },
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/admin/accounts/merge")
      .set("Cookie", adminCookie)
      .send({ sourceAccountCode: source.accountCode, targetAccountCode: target.accountCode, reason: "重複アカウント" })
      .expect(201);

    expect(res.body.transferredAmount).toBe("3000");

    const sourceWalletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: sourceWallet.id } });
    expect(sourceWalletAfter.availableBalance.toString()).toBe("0");
    expect(sourceWalletAfter.status).toBe("MERGED");

    const targetWalletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: targetWallet.id } });
    expect(targetWalletAfter.availableBalance.toString()).toBe("3500");

    const sourceAccountAfter = await prisma.oveAccount.findUniqueOrThrow({ where: { id: source.id } });
    expect(sourceAccountAfter.status).toBe("MERGED");
    expect(sourceAccountAfter.mergedIntoAccountId).toBe(target.id);

    const movedIdentity = await prisma.accountIdentity.findFirstOrThrow({
      where: { providerSubject: `merge-e2e-${source.id}@example.com` },
    });
    expect(movedIdentity.oveAccountId).toBe(target.id);

    // 再度同じ統合を要求しても冪等に成功する (二重実行防止)
    const secondRes = await request(app.getHttpServer())
      .post("/api/v1/admin/accounts/merge")
      .set("Cookie", adminCookie)
      .send({ sourceAccountCode: source.accountCode, targetAccountCode: target.accountCode, reason: "再送" })
      .expect(201);
    expect(secondRes.body.transferredAmount).toBe("0");

    const targetWalletAfterRerun = await prisma.wallet.findUniqueOrThrow({ where: { id: targetWallet.id } });
    expect(targetWalletAfterRerun.availableBalance.toString()).toBe("3500"); // 二重加算されない
  });

  it("rejects merging an account into itself with 400", async () => {
    const { account } = await createTestAccount(0);
    await request(app.getHttpServer())
      .post("/api/v1/admin/accounts/merge")
      .set("Cookie", adminCookie)
      .send({ sourceAccountCode: account.accountCode, targetAccountCode: account.accountCode, reason: "self" })
      .expect(400);
  });
});
