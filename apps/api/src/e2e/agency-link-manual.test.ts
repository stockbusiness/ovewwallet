import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration } from "./test-helpers";

/**
 * 代理店の担当者とORIアカウントを管理画面から手動で紐付ける
 * (`POST /api/v1/admin/agency-links/:id/link` / `.../unlink`)。
 *
 * 紐付けは付与イベントの宛先そのものなので、「紐付けたら実際にその人へ入る」
 * 「取り違えを止める」の2点を、付与イベントを実際に流して確かめる。
 */
describe("代理店連携の手動紐付け (管理画面から)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let auditorCookie: string[];
  let partnerApiKey: string;
  let serviceIntegrationId: string;

  async function createAdmin(role: "SUPER_ADMIN" | "AUDITOR"): Promise<string[]> {
    const email = `e2e-link-${role.toLowerCase()}-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role,
        displayName: `E2E ${role}`,
      },
    });
    const res = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    return res.headers["set-cookie"] as unknown as string[];
  }

  beforeAll(async () => {
    process.env.ENABLE_AGENCY_POINT_AWARD_INBOX = "true";

    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    adminCookie = await createAdmin("SUPER_ADMIN");
    auditorCookie = await createAdmin("AUDITOR");

    const integration = await createTestServiceIntegration("AGENCY_SYSTEM");
    partnerApiKey = integration.apiKey;
    serviceIntegrationId = (
      await prisma.serviceIntegration.findUniqueOrThrow({ where: { serviceCode: "AGENCY_SYSTEM" } })
    ).id;
  });

  afterAll(async () => {
    delete process.env.ENABLE_AGENCY_POINT_AWARD_INBOX;
    await app.close();
    await prisma.$disconnect();
  });

  async function createAccountWithWallet(): Promise<{
    accountId: string;
    accountCode: string;
    walletId: string;
  }> {
    const accountId = generateId();
    const accountCode = `OVE-ACC-TEST-${generateId()}`;
    await prisma.oveAccount.create({ data: { id: accountId, accountCode, status: "ACTIVE" } });
    const walletId = generateId();
    await prisma.wallet.create({
      data: { id: walletId, oveAccountId: accountId, walletCode: `OVE-WLT-TEST-${generateId()}`, status: "ACTIVE" },
    });
    return { accountId, accountCode, walletId };
  }

  /** 代理店同期だけが届いた状態 (ORIアカウント未確定) の行を作る。 */
  async function createPendingLink(externalUserId: string): Promise<string> {
    const link = await prisma.accountLink.create({
      data: {
        id: generateId(),
        serviceIntegrationId,
        externalUserId,
        status: "PENDING",
        linkMethod: "AGENCY_SYNC",
      },
    });
    return link.id;
  }

  function linkRequest(id: string, body: object, cookie: string[]) {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/agency-links/${id}/link`)
      .set("Cookie", cookie)
      .send(body);
  }

  function sendAward(recipientAgentId: string, points: number) {
    const eventId = `orly_wallet_${generateId()}`;
    return request(app.getHttpServer())
      .post("/api/integrations/agencies/point-awards")
      .set("x-api-key", partnerApiKey)
      .send({
        event_type: "orly.point_award.wallet_delivery",
        event_version: "1.0",
        event_id: eventId,
        source_system_key: "agency-system",
        occurred_at: new Date().toISOString(),
        point_award: {
          award_event_key: `orly_${generateId()}`,
          point_code: "orly",
          points,
          recipient_type: "upper_director",
          recipient_agent_id: recipientAgentId,
        },
      });
  }

  describe("権限", () => {
    it("rejects an unauthenticated request", async () => {
      const linkId = await createPendingLink(`agent-${generateId()}`);
      await request(app.getHttpServer())
        .post(`/api/v1/admin/agency-links/${linkId}/link`)
        .send({ account: "whatever", reason: "test" })
        .expect(401);
    });

    it("rejects an AUDITOR (read-only role)", async () => {
      const linkId = await createPendingLink(`agent-${generateId()}`);
      const { accountCode } = await createAccountWithWallet();
      await linkRequest(linkId, { account: accountCode, reason: "test" }, auditorCookie).expect(403);
    });

    it("requires a reason", async () => {
      const linkId = await createPendingLink(`agent-${generateId()}`);
      const { accountCode } = await createAccountWithWallet();
      await linkRequest(linkId, { account: accountCode }, adminCookie).expect(400);
    });
  });

  describe("紐付け", () => {
    it("makes an upper agent's award land in their wallet", async () => {
      const agentId = `agent-${generateId()}`;
      const linkId = await createPendingLink(agentId);
      const { accountId, accountCode, walletId } = await createAccountWithWallet();

      // 紐付ける前は宛先が決まらないので付与されない。
      await sendAward(agentId, 1000).expect(404);

      const res = await linkRequest(
        linkId,
        { account: accountCode, reason: "SSO未接続のため上位代理店を手動で紐付け" },
        adminCookie,
      ).expect(201);
      expect(res.body).toMatchObject({
        oveAccountId: accountId,
        status: "ACTIVE",
        linkMethod: "ADMIN_MANUAL",
      });

      // 紐付けた後は同じ担当者IDでその人の残高に入る。
      await sendAward(agentId, 1000).expect(201);
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
      expect(wallet.availableBalance).toBe(1000n);
    });

    it("accepts the internal account id as well as the account code", async () => {
      const linkId = await createPendingLink(`agent-${generateId()}`);
      const { accountId } = await createAccountWithWallet();

      const res = await linkRequest(linkId, { account: accountId, reason: "内部IDで紐付け" }, adminCookie).expect(201);
      expect(res.body.oveAccountId).toBe(accountId);
    });

    it("records who linked what and why, without the partner's raw payload", async () => {
      const agentId = `agent-${generateId()}`;
      const linkId = await createPendingLink(agentId);
      const { accountCode } = await createAccountWithWallet();

      await linkRequest(linkId, { account: accountCode, reason: "問い合わせ #123 の対応" }, adminCookie).expect(201);

      const log = await prisma.auditLog.findFirst({
        where: { actionType: "AGENCY_LINK_MANUAL_LINK", targetId: linkId },
      });
      expect(log).not.toBeNull();
      expect(log!.reason).toBe("問い合わせ #123 の対応");
      expect(log!.beforeData).toMatchObject({ status: "PENDING", oveAccountId: null });
      expect(log!.afterData).toMatchObject({ status: "ACTIVE", linkMethod: "ADMIN_MANUAL" });
    });

    it("refuses to point a second agent at an already linked account", async () => {
      const firstLinkId = await createPendingLink(`agent-${generateId()}`);
      const secondLinkId = await createPendingLink(`agent-${generateId()}`);
      const { accountCode } = await createAccountWithWallet();

      await linkRequest(firstLinkId, { account: accountCode, reason: "1人目" }, adminCookie).expect(201);
      await linkRequest(secondLinkId, { account: accountCode, reason: "2人目" }, adminCookie).expect(409);
    });

    it("refuses a link the agency system has already revoked", async () => {
      const linkId = await createPendingLink(`agent-${generateId()}`);
      await prisma.accountLink.update({
        where: { id: linkId },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      const { accountCode } = await createAccountWithWallet();

      await linkRequest(linkId, { account: accountCode, reason: "復活させたい" }, adminCookie).expect(400);
    });

    it("refuses an account that is not ACTIVE", async () => {
      const linkId = await createPendingLink(`agent-${generateId()}`);
      const { accountId, accountCode } = await createAccountWithWallet();
      await prisma.oveAccount.update({ where: { id: accountId }, data: { status: "CLOSED" } });

      await linkRequest(linkId, { account: accountCode, reason: "退会済みに紐付け" }, adminCookie).expect(400);
    });

    it("returns 404 for an unknown account and for an unknown link", async () => {
      const linkId = await createPendingLink(`agent-${generateId()}`);
      await linkRequest(linkId, { account: "OVE-ACC-DOES-NOT-EXIST", reason: "x" }, adminCookie).expect(404);
      await linkRequest(generateId(), { account: "OVE-ACC-DOES-NOT-EXIST", reason: "x" }, adminCookie).expect(404);
    });
  });

  describe("紐付け解除", () => {
    it("stops later awards from reaching the wallet", async () => {
      const agentId = `agent-${generateId()}`;
      const linkId = await createPendingLink(agentId);
      const { accountCode, walletId } = await createAccountWithWallet();

      await linkRequest(linkId, { account: accountCode, reason: "紐付け" }, adminCookie).expect(201);
      await sendAward(agentId, 500).expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/agency-links/${linkId}/unlink`)
        .set("Cookie", adminCookie)
        .send({ reason: "取り違えていたため解除" })
        .expect(201);
      expect(res.body).toMatchObject({ oveAccountId: null, status: "PENDING" });

      await sendAward(agentId, 700).expect(404);

      // 解除前に入った分はそのまま残る (台帳は遡って書き換えない)。
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
      expect(wallet.availableBalance).toBe(500n);

      const log = await prisma.auditLog.findFirst({
        where: { actionType: "AGENCY_LINK_MANUAL_UNLINK", targetId: linkId },
      });
      expect(log!.reason).toBe("取り違えていたため解除");
    });

    it("rejects unlinking a link that has no account", async () => {
      const linkId = await createPendingLink(`agent-${generateId()}`);
      await request(app.getHttpServer())
        .post(`/api/v1/admin/agency-links/${linkId}/unlink`)
        .set("Cookie", adminCookie)
        .send({ reason: "x" })
        .expect(400);
    });
  });
});
