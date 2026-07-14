import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

describe("existing-user migration (指示書15章)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-migration-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    const admin = await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Migration Admin",
      },
    });
    adminId = admin.id;

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

  it("credits known balances, sets REVIEWING for unknown balances, and never guesses a balance", async () => {
    const knownUser = `legacy-known-${generateId()}`;
    const unknownUser = `legacy-unknown-${generateId()}`;
    const csvContent = ["old_user_id,old_balance", `${knownUser},7000`, `${unknownUser},`].join("\n");

    const res = await request(app.getHttpServer())
      .post("/api/v1/admin/migrations/execute")
      .set("Cookie", adminCookie)
      .send({ fileName: "legacy.csv", csvContent, batchName: "test-batch" })
      .expect(201);

    expect(res.body.totalCount).toBe(2);
    expect(res.body.successCount).toBe(1);
    expect(res.body.reviewingCount).toBe(1);
    expect(res.body.errorCount).toBe(0);

    const knownIdentity = await prisma.accountIdentity.findUniqueOrThrow({
      where: { provider_providerSubject: { provider: "LEGACY_SYSTEM", providerSubject: knownUser } },
      include: { account: { include: { wallet: true } } },
    });
    expect(knownIdentity.account.status).toBe("ACTIVE");
    expect(knownIdentity.account.wallet?.availableBalance.toString()).toBe("7000");

    const unknownIdentity = await prisma.accountIdentity.findUniqueOrThrow({
      where: { provider_providerSubject: { provider: "LEGACY_SYSTEM", providerSubject: unknownUser } },
      include: { account: { include: { wallet: true } } },
    });
    expect(unknownIdentity.account.status).toBe("REVIEWING"); // 推定残高は入れない
    expect(unknownIdentity.account.wallet?.availableBalance.toString()).toBe("0");

    const batch = await prisma.migrationBatch.findUniqueOrThrow({ where: { id: res.body.batchId } });
    expect(batch.status).toBe("COMPLETED");
    expect(batch.executedBy).toBe(adminId);
    expect(batch.sourceDataHash).toHaveLength(64); // sha256 hex

    // 同じCSVを再実行しても二重付与されない
    const secondRes = await request(app.getHttpServer())
      .post("/api/v1/admin/migrations/execute")
      .set("Cookie", adminCookie)
      .send({ fileName: "legacy.csv", csvContent, batchName: "test-batch-rerun" })
      .expect(201);
    expect(secondRes.body.successCount).toBe(1); // findOrCreateはヒットするがcreditは冪等キーで弾かれる

    const knownWalletAfterRerun = await prisma.wallet.findUniqueOrThrow({
      where: { oveAccountId: knownIdentity.account.id },
    });
    expect(knownWalletAfterRerun.availableBalance.toString()).toBe("7000"); // 二重付与されない
  });
});
