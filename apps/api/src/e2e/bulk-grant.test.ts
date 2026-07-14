import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER, WALLET_CODE_COUNTER } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

describe("CSV bulk grant (preview -> execute)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let accountCode: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-bulk-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Bulk Grant Admin",
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = loginRes.headers["set-cookie"] as unknown as string[];

    accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const account = await prisma.oveAccount.create({
      data: { id: generateId(), accountCode, status: "ACTIVE" },
    });
    const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
    await prisma.wallet.create({
      data: { id: generateId(), oveAccountId: account.id, walletCode, status: "ACTIVE" },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("preview does not touch wallet balance; execute (with batchId) does, and re-execute stays idempotent", async () => {
    const key = `bulk-e2e-${generateId()}`;
    const csvContent = [
      "external_user_id,amount,transaction_name,reason,event_id,idempotency_key",
      `${accountCode},2500,テストキャンペーン,テスト,EVT-1,${key}`,
      `UNKNOWN-ACCOUNT-CODE,100,x,x,EVT-2,unknown-${generateId()}`,
    ].join("\n");

    const previewRes = await request(app.getHttpServer())
      .post("/api/v1/admin/bulk-grants/preview")
      .set("Cookie", adminCookie)
      .send({ fileName: "test.csv", csvContent })
      .expect(201);

    expect(previewRes.body.totalCount).toBe(2);
    expect(previewRes.body.successCount).toBe(1);
    expect(previewRes.body.unknownUserCount).toBe(1);

    const balanceAfterPreview = await request(app.getHttpServer())
      .get(`/api/v1/wallets/${(await prisma.oveAccount.findUniqueOrThrow({ where: { accountCode } })).id}/balance`)
      .expect(200);
    expect(balanceAfterPreview.body.available_balance).toBe("0"); // プレビューでは反映されない

    const batchId = previewRes.body.batchId;
    const executeRes = await request(app.getHttpServer())
      .post("/api/v1/admin/bulk-grants/execute")
      .set("Cookie", adminCookie)
      .send({ fileName: "test.csv", csvContent, batchId })
      .expect(201);
    expect(executeRes.body.successCount).toBe(1);

    const accountRow = await prisma.oveAccount.findUniqueOrThrow({ where: { accountCode } });
    const balanceAfterExecute = await request(app.getHttpServer())
      .get(`/api/v1/wallets/${accountRow.id}/balance`)
      .expect(200);
    expect(balanceAfterExecute.body.available_balance).toBe("2500");

    // 同じCSVを再実行しても二重付与されない
    const secondExecuteRes = await request(app.getHttpServer())
      .post("/api/v1/admin/bulk-grants/execute")
      .set("Cookie", adminCookie)
      .send({ fileName: "test.csv", csvContent })
      .expect(201);
    expect(secondExecuteRes.body.duplicateCount).toBe(1);

    const balanceAfterRerun = await request(app.getHttpServer())
      .get(`/api/v1/wallets/${accountRow.id}/balance`)
      .expect(200);
    expect(balanceAfterRerun.body.available_balance).toBe("2500"); // 変わらない
  });
});
