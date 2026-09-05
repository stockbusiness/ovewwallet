import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ThrottlerStorage } from "@nestjs/throttler";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const PATH = "/api/v1/admin/email-domains";

/**
 * 使い捨てメールドメインの個別指定を管理画面から編集する
 * (docs/email-domain-policy.md)。
 */
describe("メールドメイン設定 (管理画面)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let auditorCookie: string[];
  const createdDomains: string[] = [];

  async function loginAdmin(role: "SUPER_ADMIN" | "AUDITOR"): Promise<string[]> {
    const email = `e2e-domains-${role}-${generateId()}@ovewallet.local`;
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

  function resetThrottle() {
    const storage = app.get<ThrottlerStorage & { storage?: Map<string, unknown> }>(ThrottlerStorage);
    storage.storage?.clear();
  }

  function newDomain(): string {
    const domain = `e2e-${generateId()}.example`.toLowerCase();
    createdDomains.push(domain);
    return domain;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    adminCookie = await loginAdmin("SUPER_ADMIN");
    auditorCookie = await loginAdmin("AUDITOR");
  });

  beforeEach(() => {
    resetThrottle();
  });

  afterAll(async () => {
    await prisma.emailDomainRule.deleteMany({ where: { domain: { in: createdDomains } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("追加して一覧に出る", async () => {
    const domain = newDomain();
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ domain, action: "BLOCK", reason: "スパム登録が続いたため" })
      .expect(201);

    const res = await request(app.getHttpServer()).get(PATH).set("Cookie", adminCookie).expect(200);
    const found = res.body.rules.find((r: { domain: string }) => r.domain === domain);
    expect(found).toMatchObject({ domain, action: "BLOCK", reason: "スパム登録が続いたため" });
  });

  it("組み込みリストの件数を返す (何件を既定で弾いているか運用者が分かる)", async () => {
    const res = await request(app.getHttpServer()).get(PATH).set("Cookie", adminCookie).expect(200);
    expect(res.body.built_in_count).toBeGreaterThan(1000);
  });

  it("@ 付きで貼られてもドメイン部だけを取る", async () => {
    const domain = newDomain();
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ domain: `someone@${domain}`, action: "BLOCK" })
      .expect(201);
    expect(res.body.domain).toBe(domain);
  });

  it("1ラベルのドメインは登録できない (全ドメインが塞がるため)", async () => {
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ domain: "com", action: "BLOCK" })
      .expect(400);
  });

  it("同じドメインの再登録は上書きになる (BLOCK と ALLOW の切り替え)", async () => {
    const domain = newDomain();
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ domain, action: "BLOCK" })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ domain, action: "ALLOW" })
      .expect(201);

    expect(res.body.action).toBe("ALLOW");
    expect(await prisma.emailDomainRule.count({ where: { domain } })).toBe(1);
  });

  it("削除できる", async () => {
    const domain = newDomain();
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ domain, action: "BLOCK" })
      .expect(201);
    await request(app.getHttpServer()).delete(`${PATH}/${domain}`).set("Cookie", adminCookie).expect(200);

    expect(await prisma.emailDomainRule.findUnique({ where: { domain } })).toBeNull();
  });

  it("未登録のドメインは削除できない", async () => {
    await request(app.getHttpServer())
      .delete(`${PATH}/not-registered-${generateId()}.example`)
      .set("Cookie", adminCookie)
      .expect(400);
  });

  it("追加・削除が監査ログに残る", async () => {
    const domain = newDomain();
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ domain, action: "BLOCK", reason: "調査のため" })
      .expect(201);
    await request(app.getHttpServer()).delete(`${PATH}/${domain}`).set("Cookie", adminCookie).expect(200);

    const logs = await prisma.auditLog.findMany({
      where: { targetType: "email_domain_rules", targetId: domain },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((l) => l.actionType)).toEqual([
      "EMAIL_DOMAIN_RULE_ADDED",
      "EMAIL_DOMAIN_RULE_REMOVED",
    ]);
  });

  it("AUDITOR は閲覧できるが変更はできない", async () => {
    await request(app.getHttpServer()).get(PATH).set("Cookie", auditorCookie).expect(200);
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", auditorCookie)
      .send({ domain: newDomain(), action: "BLOCK" })
      .expect(403);
  });

  it("ログインしていないと触れない", async () => {
    await request(app.getHttpServer()).get(PATH).expect(401);
    await request(app.getHttpServer()).post(PATH).send({ domain: "a.example", action: "BLOCK" }).expect(401);
  });
});
