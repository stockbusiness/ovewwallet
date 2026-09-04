import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER } from "@ove/database";
import { encryptSecret, hashSecret, sha256Hex, generateOpaqueToken } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";

/**
 * 紹介の紐付けは新規アカウント作成時にしか起きないため、先にウォレットへ登録して
 * しまった人は代理店の成果にならない。退会させても救済にならない (退会済みの
 * identityでは再登録できない)。その個別救済の操作を固定する。
 */
describe("POST /api/v1/admin/wallet-referrals/:id/attach (紹介の後付け紐付け)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const email = `e2e-referral-admin-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "E2E Referral Admin",
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    adminCookie = loginRes.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createAccount() {
    const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    return prisma.oveAccount.create({
      data: { id: generateId(), accountCode, status: "ACTIVE", displayName: "手動紐付けテスト" },
    });
  }

  /** 代理店システムの紹介セッションまで揃っている、通常の受付済み紹介。 */
  async function createReferral(
    overrides: Partial<{
      status: "CAPTURED" | "EXPIRED" | "PENDING";
      referralSessionKey: string | null;
      expiresAt: Date;
    }> = {},
  ) {
    const rawToken = `rt_${generateOpaqueToken(8)}`;
    const sessionKey = overrides.referralSessionKey === undefined ? `rs_${generateOpaqueToken(8)}` : overrides.referralSessionKey;
    return prisma.walletReferral.create({
      data: {
        id: generateId(),
        sessionTokenHash: sha256Hex(generateOpaqueToken(32)),
        referralTokenEncrypted: encryptSecret(rawToken, ENCRYPTION_KEY),
        referralTokenHash: sha256Hex(rawToken),
        status: overrides.status ?? "CAPTURED",
        source: "invite_url",
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
        ...(sessionKey
          ? {
              referralSessionKey: sessionKey,
              canonicalReferralTokenEncrypted: encryptSecret(rawToken, ENCRYPTION_KEY),
            }
          : {}),
      },
    });
  }

  function attach(referralId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/wallet-referrals/${referralId}/attach`)
      .set("Cookie", adminCookie)
      .send(body);
  }

  it("rejects unauthenticated access", async () => {
    const referral = await createReferral();
    await request(app.getHttpServer())
      .post(`/api/v1/admin/wallet-referrals/${referral.id}/attach`)
      .send({ account: "OVE-ACC-00000001", reason: "test" })
      .expect(401);
  });

  it("requires a reason", async () => {
    const referral = await createReferral();
    const account = await createAccount();
    await attach(referral.id, { account: account.accountCode }).expect(400);
  });

  it("attaches a CAPTURED referral and leaves the confirmation to the normal outbox path", async () => {
    const referral = await createReferral();
    const account = await createAccount();

    const res = await attach(referral.id, {
      account: account.accountCode,
      reason: "先にLINEで登録済みだったため後付け",
    }).expect(201);

    expect(res.body.walletUserId).toBe(account.id);
    // CONFIRMEDにはしない。成果を認める正本は代理店システム側にあり、ここで確定に
    // してしまうと連携先の記録と食い違う。
    expect(res.body.status).toBe("PENDING");
    expect(res.body.source).toBe("admin");

    const outbox = await prisma.integrationOutbox.findFirst({
      where: { aggregateId: referral.id, eventType: "wallet.referral.registered" },
    });
    expect(outbox).not.toBeNull();
    expect(outbox!.destinationService).toBe("AGENCY_SYSTEM");

    const audit = await prisma.auditLog.findFirst({
      where: { targetType: "wallet_referral", targetId: referral.id },
    });
    expect(audit!.actionType).toBe("WALLET_REFERRAL_ATTACHED_MANUALLY");
    expect(audit!.reason).toBe("先にLINEで登録済みだったため後付け");
  });

  it("attaches a referral whose grace period has passed but which is still CAPTURED", async () => {
    // statusがEXPIREDになるのは`resolvePendingSession`が期限後に呼ばれたときだけで、
    // 単に猶予を過ぎただけの行はCAPTUREDのまま残る。救済の主な対象はこちら。
    const referral = await createReferral({ expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    const account = await createAccount();

    const res = await attach(referral.id, { account: account.accountCode, reason: "猶予切れの救済" }).expect(201);

    expect(res.body.status).toBe("PENDING");
  });

  it("refuses an EXPIRED referral, which is a terminal state", async () => {
    // 終端状態からの復帰は`referral-state-machine.ts`の不変条件を崩すため許さない。
    const referral = await createReferral({
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const account = await createAccount();

    const res = await attach(referral.id, { account: account.accountCode, reason: "期限切れ" }).expect(400);

    expect(res.body.message).toContain("EXPIRED");
  });

  it("refuses a referral with no agency session, which could never be confirmed", async () => {
    const referral = await createReferral({ referralSessionKey: null });
    const account = await createAccount();

    const res = await attach(referral.id, { account: account.accountCode, reason: "セッション無し" }).expect(400);

    expect(res.body.message).toContain("紹介セッション");
    const after = await prisma.walletReferral.findUniqueOrThrow({ where: { id: referral.id } });
    expect(after.walletUserId).toBeNull();
  });

  it("refuses to move an already confirmed referral", async () => {
    const referral = await createReferral({ status: "PENDING" });
    const account = await createAccount();

    await attach(referral.id, { account: account.accountCode, reason: "確定済みを動かす" }).expect(400);
  });

  it("refuses a second referral for the same account", async () => {
    const account = await createAccount();
    const first = await createReferral();
    await attach(first.id, { account: account.accountCode, reason: "1件目" }).expect(201);

    const second = await createReferral();
    const res = await attach(second.id, { account: account.accountCode, reason: "2件目" }).expect(409);

    expect(res.body.message).toContain("既に紹介");
  });

  it("refuses a referral that is already attached to someone", async () => {
    const referral = await createReferral();
    const first = await createAccount();
    await attach(referral.id, { account: first.accountCode, reason: "1人目" }).expect(201);

    const second = await createAccount();
    await attach(referral.id, { account: second.accountCode, reason: "2人目" }).expect(409);
  });

  it("refuses a non-ACTIVE account", async () => {
    const referral = await createReferral();
    const account = await createAccount();
    await prisma.oveAccount.update({ where: { id: account.id }, data: { status: "CLOSED" } });

    const res = await attach(referral.id, { account: account.accountCode, reason: "退会済み" }).expect(400);

    expect(res.body.message).toContain("CLOSED");
  });
});
