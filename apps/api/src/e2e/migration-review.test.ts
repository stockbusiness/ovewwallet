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
 * 既存ユーザー移行 (指示書15章) の検証者フロー。残高不明で REVIEWING になった
 * アカウントを、検証者が調査済みの確認済み残高で解消する
 * (`POST /api/v1/admin/accounts/:accountId/resolve-review`)。
 */
describe("migration review resolution (指示書15章 検証者フロー)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let requesterCookie: string[];
  let approverCookie: string[];

  /** 移行実行は事前承認制 (指示書15章) のため、申請 → 別管理者による承認、の順に呼び出す。 */
  async function createReviewingAccount(): Promise<{ accountId: string; walletId: string }> {
    const unknownUser = `legacy-review-${generateId()}`;
    const csvContent = ["old_user_id,old_balance", `${unknownUser},`].join("\n");

    const requestRes = await request(app.getHttpServer())
      .post("/api/v1/admin/migrations/request")
      .set("Cookie", requesterCookie)
      .send({ fileName: "legacy.csv", csvContent, batchName: `review-test-${generateId()}`, reason: "テスト移行" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/approval-requests/${requestRes.body.approvalRequestId}/approve`)
      .set("Cookie", approverCookie)
      .expect(201);

    const identity = await prisma.accountIdentity.findUniqueOrThrow({
      where: { provider_providerSubject: { provider: "LEGACY_SYSTEM", providerSubject: unknownUser } },
      include: { account: { include: { wallet: true } } },
    });
    return { accountId: identity.account.id, walletId: identity.account.wallet!.id };
  }

  async function createAdmin(displayName: string): Promise<string[]> {
    const email = `e2e-migration-review-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
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
    return loginRes.headers["set-cookie"] as unknown as string[];
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    adminCookie = await createAdmin("E2E Migration Review Admin");
    requesterCookie = await createAdmin("E2E Migration Review Requester");
    approverCookie = await createAdmin("E2E Migration Review Approver");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("resolves a REVIEWING account with a verifier-confirmed positive balance", async () => {
    const { accountId, walletId } = await createReviewingAccount();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-review`)
      .set("Cookie", adminCookie)
      .send({ confirmedBalance: 4200, reason: "旧システムの管理画面で残高を確認した" })
      .expect(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.transaction.amount).toBe("4200");

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.status).toBe("ACTIVE");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.availableBalance.toString()).toBe("4200");
  });

  it("resolves a REVIEWING account with a confirmed zero balance without creating a transaction", async () => {
    const { accountId, walletId } = await createReviewingAccount();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-review`)
      .set("Cookie", adminCookie)
      .send({ confirmedBalance: 0, reason: "旧システムに残高が無いことを確認した" })
      .expect(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.transaction).toBeNull();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.availableBalance.toString()).toBe("0");
  });

  it("rejects resolving an account that is not in REVIEWING status with 409", async () => {
    const { accountId } = await createReviewingAccount();
    await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-review`)
      .set("Cookie", adminCookie)
      .send({ confirmedBalance: 100, reason: "1回目" })
      .expect(201);

    // すでにACTIVEになっているので2回目は409
    await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-review`)
      .set("Cookie", adminCookie)
      .send({ confirmedBalance: 200, reason: "2回目" })
      .expect(409);
  });

  it("rejects a negative confirmedBalance with 400", async () => {
    const { accountId } = await createReviewingAccount();
    await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-review`)
      .set("Cookie", adminCookie)
      .send({ confirmedBalance: -1, reason: "不正な値" })
      .expect(400);
  });

  it("rejects unauthenticated access with 401", async () => {
    const { accountId } = await createReviewingAccount();
    await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-review`)
      .send({ confirmedBalance: 100, reason: "no auth" })
      .expect(401);
  });

  it("rejects resolving by the admin who executed the migration that created the REVIEWING account (separation of duties)", async () => {
    const { accountId } = await createReviewingAccount();

    // requesterCookie の管理者が、このアカウントを移行実行時にREVIEWINGにした本人
    // (migration_batches.executed_by = 申請者、docs/migration.md「事前承認制・職務分離」参照)。
    await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-review`)
      .set("Cookie", requesterCookie)
      .send({ confirmedBalance: 100, reason: "実行者本人による解消" })
      .expect(400);

    // 承認者 (verified_by) や無関係な管理者は問題なく解消できる。
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-review`)
      .set("Cookie", approverCookie)
      .send({ confirmedBalance: 100, reason: "承認者による解消" })
      .expect(201);
    expect(res.body.status).toBe("ACTIVE");
  });
});
