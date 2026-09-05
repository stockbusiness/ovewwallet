import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ThrottlerStorage } from "@nestjs/throttler";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { EmailDomainPolicyService } from "../auth/email-domain-policy.service";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 使い捨てメールアドレスでの登録を防ぐ (docs/email-domain-policy.md)。
 *
 * 登録特典の発行総数に上限を設けない方針のため、**捨てアドレスで何度でも
 * アカウントを作れてしまうこと自体を塞ぐ**のがここの目的。
 */
describe("使い捨てメールドメインの遮断", () => {
  let app: INestApplication;
  let policy: EmailDomainPolicyService;
  const createdDomains: string[] = [];

  function resetThrottle() {
    const storage = app.get<ThrottlerStorage & { storage?: Map<string, unknown> }>(ThrottlerStorage);
    storage.storage?.clear();
  }

  async function requestOtp(email: string) {
    return request(app.getHttpServer()).post("/api/v1/auth/email/request-otp").send({ email });
  }

  /** 管理画面から追加したのと同じ状態を作る。キャッシュも明示的に捨てる。 */
  async function addRule(domain: string, action: "BLOCK" | "ALLOW") {
    await prisma.emailDomainRule.upsert({
      where: { domain },
      create: { domain, action },
      update: { action },
    });
    createdDomains.push(domain);
    policy.invalidateCache();
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    policy = app.get(EmailDomainPolicyService);
  });

  beforeEach(() => {
    resetThrottle();
  });

  afterAll(async () => {
    await prisma.emailDomainRule.deleteMany({ where: { domain: { in: createdDomains } } });
    policy.invalidateCache();
    await app.close();
    await prisma.$disconnect();
  });

  it("組み込みリストのドメインはコードを発行しない", async () => {
    const res = await requestOtp(`spam-${generateId()}@mailinator.com`);
    expect(res.status).toBe(400);
    // 理由を伝える。誤って弾かれた利用者が「コードが届かない」と待ち続けないため。
    expect(res.body.error).toBe("disposable_email_domain");
  });

  it("組み込みリストのサブドメインでも弾く", async () => {
    const res = await requestOtp(`spam-${generateId()}@sub.mailinator.com`);
    expect(res.status).toBe(400);
  });

  it("通常のドメインはこれまでどおり発行できる", async () => {
    const res = await requestOtp(`ok-${generateId()}@example.com`);
    expect(res.status).toBe(201);
    expect(res.body.devCode).toMatch(/^\d{6}$/);
  });

  it("管理画面で追加したドメインを弾く", async () => {
    const domain = `blocked-${generateId()}.example`.toLowerCase();
    // 追加前は通ることを先に確かめ、追加そのものが効いていることを示す。
    expect((await requestOtp(`user@${domain}`)).status).toBe(201);

    resetThrottle();
    await addRule(domain, "BLOCK");
    expect((await requestOtp(`user@${domain}`)).status).toBe(400);
  });

  it("ALLOW は組み込みリストより優先される (誤検知の解除)", async () => {
    await addRule("mailinator.com", "ALLOW");
    const res = await requestOtp(`ok-${generateId()}@mailinator.com`);
    expect(res.status).toBe(201);
  });

  it("コードを発行しないので送信も行われない", async () => {
    // 弾いたうえでコードだけ発行されていると、クールダウンだけ消費されて
    // 正規のアドレスへ切り替えた利用者が待たされる。
    const res = await requestOtp(`spam-${generateId()}@guerrillamail.com`);
    expect(res.status).toBe(400);
    expect(res.body.devCode).toBeUndefined();
  });
});
