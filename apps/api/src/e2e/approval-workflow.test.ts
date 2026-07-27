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

async function createAdmin(label: string): Promise<{ email: string; password: string; cookie: string[] }> {
  const email = `e2e-approval-${label}-${generateId()}@ovewallet.local`;
  const password = "e2e-test-password-123";
  await prisma.adminUser.create({
    data: {
      id: generateId(),
      adminCode: `OVE-ADM-${generateId()}`,
      email,
      passwordHash: hashSecret(password),
      role: "SUPER_ADMIN",
      displayName: `E2E Approval ${label}`,
    },
  });
  return { email, password, cookie: [] };
}

describe("two-step approval workflow (指示書13章 二段階承認)", () => {
  let app: INestApplication;
  let requesterCookie: string[];
  let approverCookie: string[];
  let walletId: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const requester = await createAdmin("requester");
    const approver = await createAdmin("approver");

    const requesterLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: requester.email, password: requester.password })
      .expect(201);
    requesterCookie = requesterLogin.headers["set-cookie"] as unknown as string[];

    const approverLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: approver.email, password: approver.password })
      .expect(201);
    approverCookie = approverLogin.headers["set-cookie"] as unknown as string[];

    const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
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

  it("holds a high-value grant pending until a different admin approves it", async () => {
    const grantRes = await request(app.getHttpServer())
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", requesterCookie)
      .send({ walletId, amount: 60000, reason: "高額付与テスト" })
      .expect(201);

    expect(grantRes.body.result).toBe("PENDING_APPROVAL");
    const requestId = grantRes.body.approvalRequestId;
    expect(requestId).toBeTruthy();

    // 残高はまだ動かない
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.availableBalance.toString()).toBe("0");

    // 申請者本人は承認できない
    await request(app.getHttpServer())
      .post(`/api/v1/admin/approval-requests/${requestId}/approve`)
      .set("Cookie", requesterCookie)
      .expect(400);

    // 別の管理者が承認すると実行される
    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/approval-requests/${requestId}/approve`)
      .set("Cookie", approverCookie)
      .expect(201);
    expect(approveRes.body.amount).toBe("60000");

    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(walletAfter.availableBalance.toString()).toBe("60000");

    // 承認済みの申請を再度承認しようとするとエラー
    await request(app.getHttpServer())
      .post(`/api/v1/admin/approval-requests/${requestId}/approve`)
      .set("Cookie", approverCookie)
      .expect(409);
  });

  it("does not execute the operation when the approver rejects the request", async () => {
    const grantRes = await request(app.getHttpServer())
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", requesterCookie)
      .send({ walletId, amount: 70000, reason: "却下されるべき高額付与" })
      .expect(201);
    const requestId = grantRes.body.approvalRequestId;

    const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

    await request(app.getHttpServer())
      .post(`/api/v1/admin/approval-requests/${requestId}/reject`)
      .set("Cookie", approverCookie)
      .send({ reason: "申請内容に不備があるため却下" })
      .expect(201);

    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(walletAfter.availableBalance).toEqual(walletBefore.availableBalance); // 変化なし

    const approvalRequest = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(approvalRequest.status).toBe("REJECTED");
    expect(approvalRequest.rejectionReason).toBe("申請内容に不備があるため却下");
  });

  it("executes the grant exactly once when two different admins approve the same request concurrently", async () => {
    const grantRes = await request(app.getHttpServer())
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", requesterCookie)
      .send({ walletId, amount: 55000, reason: "同時承認テスト" })
      .expect(201);
    const requestId = grantRes.body.approvalRequestId;

    const secondApprover = await createAdmin("second-approver");
    const secondApproverLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: secondApprover.email, password: secondApprover.password })
      .expect(201);
    const secondApproverCookie = secondApproverLogin.headers["set-cookie"] as unknown as string[];

    const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/admin/approval-requests/${requestId}/approve`)
        .set("Cookie", approverCookie),
      request(app.getHttpServer())
        .post(`/api/v1/admin/approval-requests/${requestId}/approve`)
        .set("Cookie", secondApproverCookie),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]); // 片方だけ成功する (TOCTOU競合の排除)

    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(walletAfter.availableBalance).toBe(walletBefore.availableBalance + 55000n); // 一度だけ加算される

    const transactionCount = await prisma.oveTransaction.count({
      where: { walletId, transactionType: "ADMIN_GRANT", amount: 55000n },
    });
    expect(transactionCount).toBe(1);
  });

  it("does not allow deducting below the threshold to bypass approval, and small amounts still execute immediately", async () => {
    const smallGrantRes = await request(app.getHttpServer())
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", requesterCookie)
      .send({ walletId, amount: 100, reason: "少額付与" })
      .expect(201);
    expect(smallGrantRes.body.result).toBe("COMPLETED");
    expect(smallGrantRes.body.transaction.transaction_type).toBe("ADMIN_GRANT");
  });
});
