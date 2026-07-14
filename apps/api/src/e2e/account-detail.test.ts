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
import { createTestServiceIntegration } from "./test-helpers";

describe("アカウント詳細画面 (指示書13章)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-accountdetail-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E AccountDetail Admin",
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

  it("returns account basics, wallet, identities, service links, and audit logs", async () => {
    const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const account = await prisma.oveAccount.create({
      data: { id: generateId(), accountCode, status: "ACTIVE", primaryEmail: `detail-${generateId()}@example.com` },
    });
    const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
    const wallet = await prisma.wallet.create({
      data: { id: generateId(), oveAccountId: account.id, walletCode, status: "ACTIVE", availableBalance: 1000 },
    });
    await prisma.accountIdentity.create({
      data: {
        id: generateId(),
        oveAccountId: account.id,
        identityType: "EMAIL",
        provider: "EMAIL",
        providerSubject: account.primaryEmail!,
      },
    });
    const integration = await createTestServiceIntegration("SENGOKU_PASSPORT");
    await prisma.accountLink.create({
      data: {
        id: generateId(),
        oveAccountId: account.id,
        serviceIntegrationId: integration.id,
        externalUserId: `ext-${generateId()}`,
        linkMethod: "OAUTH",
      },
    });

    await request(app.getHttpServer())
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId: wallet.id, amount: 500, reason: "アカウント詳細テスト用付与" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/accounts/${account.id}`)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(res.body.accountCode).toBe(accountCode);
    expect(res.body.wallet.id).toBe(wallet.id);
    expect(res.body.wallet.availableBalance).toBe("1500");
    expect(res.body.identities).toHaveLength(1);
    expect(res.body.identities[0].identityType).toBe("EMAIL");
    expect(res.body.links).toHaveLength(1);
    expect(res.body.links[0].serviceIntegration.serviceCode).toBe("SENGOKU_PASSPORT");
    expect(res.body.mergedIntoAccount).toBeNull();
  });

  it("returns 404 for an unknown account id", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/admin/accounts/${generateId()}`)
      .set("Cookie", adminCookie)
      .expect(404);
  });

  it("shows the merge target on a merged account's detail", async () => {
    async function createTestAccount(balance = 0) {
      const code = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
      const acc = await prisma.oveAccount.create({ data: { id: generateId(), accountCode: code, status: "ACTIVE" } });
      const wCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
      await prisma.wallet.create({
        data: { id: generateId(), oveAccountId: acc.id, walletCode: wCode, status: "ACTIVE", availableBalance: balance },
      });
      return acc;
    }

    const source = await createTestAccount(200);
    const target = await createTestAccount(0);

    await request(app.getHttpServer())
      .post("/api/v1/admin/accounts/merge")
      .set("Cookie", adminCookie)
      .send({ sourceAccountCode: source.accountCode, targetAccountCode: target.accountCode, reason: "詳細画面テスト" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/accounts/${source.id}`)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(res.body.status).toBe("MERGED");
    expect(res.body.mergedIntoAccount.id).toBe(target.id);
  });
});
