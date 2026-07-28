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
  let requesterCookie: string[];
  let approverCookie: string[];
  let requesterId: string;
  let approverId: string;

  async function createAdmin(displayName: string): Promise<{ id: string; cookie: string[] }> {
    const email = `e2e-migration-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    const admin = await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName,
      },
    });
    const loginRes = await request(app.getHttpServer()).post("/api/v1/admin/login").send({ email, password }).expect(201);
    return { id: admin.id, cookie: loginRes.headers["set-cookie"] as unknown as string[] };
  }

  /** 移行実行は事前承認制 (指示書15章): 申請 → 別管理者による承認 → 実行、の順に呼び出す。 */
  async function requestAndApprove(
    fileName: string,
    csvContent: string,
    batchName: string,
  ): Promise<{ batchId: string; totalCount: number; successCount: number; reviewingCount: number; errorCount: number }> {
    const requestRes = await request(app.getHttpServer())
      .post("/api/v1/admin/migrations/request")
      .set("Cookie", requesterCookie)
      .send({ fileName, csvContent, batchName, reason: "テスト移行" })
      .expect(201);
    expect(requestRes.body.result).toBe("PENDING_APPROVAL");

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/approval-requests/${requestRes.body.approvalRequestId}/approve`)
      .set("Cookie", approverCookie)
      .expect(201);
    return approveRes.body;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const requester = await createAdmin("E2E Migration Requester");
    const approver = await createAdmin("E2E Migration Approver");
    requesterId = requester.id;
    approverId = approver.id;
    requesterCookie = requester.cookie;
    approverCookie = approver.cookie;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("credits known balances, sets REVIEWING for unknown balances, and never guesses a balance", async () => {
    const knownUser = `legacy-known-${generateId()}`;
    const unknownUser = `legacy-unknown-${generateId()}`;
    const csvContent = ["old_user_id,old_balance", `${knownUser},7000`, `${unknownUser},`].join("\n");

    const summary = await requestAndApprove("legacy.csv", csvContent, "test-batch");

    expect(summary.totalCount).toBe(2);
    expect(summary.successCount).toBe(1);
    expect(summary.reviewingCount).toBe(1);
    expect(summary.errorCount).toBe(0);

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

    const batch = await prisma.migrationBatch.findUniqueOrThrow({ where: { id: summary.batchId } });
    expect(batch.status).toBe("COMPLETED");
    expect(batch.executedBy).toBe(requesterId); // 実行者 = 申請者
    expect(batch.verifiedBy).toBe(approverId); // 検証者 = 承認者
    expect(batch.sourceDataHash).toHaveLength(64); // sha256 hex

    // 同じCSVを再実行 (再申請・再承認) しても二重付与されない
    const secondSummary = await requestAndApprove("legacy.csv", csvContent, "test-batch-rerun");
    expect(secondSummary.successCount).toBe(1); // findOrCreateはヒットするがcreditは冪等キーで弾かれる

    const knownWalletAfterRerun = await prisma.wallet.findUniqueOrThrow({
      where: { oveAccountId: knownIdentity.account.id },
    });
    expect(knownWalletAfterRerun.availableBalance.toString()).toBe("7000"); // 二重付与されない
  });

  it("rejects requesting migration execution with 400 if reason is missing", async () => {
    const csvContent = ["old_user_id,old_balance", `legacy-${generateId()},100`].join("\n");
    await request(app.getHttpServer())
      .post("/api/v1/admin/migrations/request")
      .set("Cookie", requesterCookie)
      .send({ fileName: "legacy.csv", csvContent, batchName: "no-reason" })
      .expect(400);
  });

  it("rejects approval by the requester themself with 400 (separation of duties)", async () => {
    const csvContent = ["old_user_id,old_balance", `legacy-${generateId()},100`].join("\n");
    const requestRes = await request(app.getHttpServer())
      .post("/api/v1/admin/migrations/request")
      .set("Cookie", requesterCookie)
      .send({ fileName: "legacy.csv", csvContent, batchName: "self-approve-test", reason: "テスト" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/approval-requests/${requestRes.body.approvalRequestId}/approve`)
      .set("Cookie", requesterCookie)
      .expect(400);
  });
});
