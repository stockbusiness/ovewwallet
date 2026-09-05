import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ThrottlerStorage } from "@nestjs/throttler";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * Gmailの別名アドレスで二重登録させない (docs/email-domain-policy.md)。
 *
 * 使い捨てドメインを塞いでも、`tanaka+1@gmail.com` `tanaka+2@gmail.com` …と
 * 増やせば**Gmailアカウント1つで何人分でも登録できてしまう**。登録特典の
 * 発行総数に上限を設けない方針のため、ここを塞いでおく必要がある。
 */
describe("メール別名アドレスの同一性", () => {
  let app: INestApplication;

  function resetThrottle() {
    const storage = app.get<ThrottlerStorage & { storage?: Map<string, unknown> }>(ThrottlerStorage);
    storage.storage?.clear();
  }

  async function requestCode(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/email/request-otp")
      .send({ email })
      .expect(201);
    return res.body.devCode as string;
  }

  async function registerWith(email: string): Promise<string> {
    const code = await requestCode(email);
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/email/verify-otp")
      .send({ email, code, termsAccepted: true })
      .expect(201);
    return res.body.ove_account_id as string;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    resetThrottle();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("+ を付け替えても同じアカウントになる", async () => {
    const local = `alias-${generateId()}`.toLowerCase();
    const first = await registerWith(`${local}+1@gmail.com`);
    resetThrottle();
    const second = await registerWith(`${local}+2@gmail.com`);

    expect(second).toBe(first);
  });

  it("ドットを入れ替えても同じアカウントになる", async () => {
    const local = `dotalias${generateId()}`.toLowerCase();
    const first = await registerWith(`${local}@gmail.com`);
    resetThrottle();
    const second = await registerWith(`${local.slice(0, 3)}.${local.slice(3)}@gmail.com`);

    expect(second).toBe(first);
  });

  it("provider_subject には正規形が入る", async () => {
    const local = `subject-${generateId()}`.toLowerCase();
    const accountId = await registerWith(`${local}+shop@gmail.com`);

    const identity = await prisma.accountIdentity.findFirstOrThrow({
      where: { oveAccountId: accountId, provider: "EMAIL" },
    });
    expect(identity.providerSubject).toBe(`${local}@gmail.com`);
  });

  it("別名を潰してよいと分かっていないドメインでは別アカウントのまま", async () => {
    // + より前が同じでも別の受信箱でありうるドメインまで潰すと、
    // 他人のアカウントに入れてしまう。
    const local = `other-${generateId()}`.toLowerCase();
    const first = await registerWith(`${local}+1@example.com`);
    resetThrottle();
    const second = await registerWith(`${local}+2@example.com`);

    expect(second).not.toBe(first);
  });

  it("正規化を入れる前に別名で登録済みの人は、そのまま既存アカウントに入る", async () => {
    // 正規形へ寄せてしまうと、その人には新しい空のアカウントが作られ、
    // 残高ごと別のアカウントへ移ったように見える。
    const local = `legacy-${generateId()}`.toLowerCase();
    const aliasEmail = `${local}+old@gmail.com`;

    const legacyAccount = await prisma.oveAccount.create({
      data: {
        id: generateId(),
        accountCode: `OVE-ACC-TEST-${generateId()}`.slice(0, 40),
        status: "ACTIVE",
        primaryEmail: aliasEmail,
        termsAgreedAt: new Date(),
        termsVersion: "1.0",
        identities: {
          create: {
            id: generateId(),
            identityType: "EMAIL",
            provider: "EMAIL",
            providerSubject: aliasEmail,
            email: aliasEmail,
            verifiedAt: new Date(),
            status: "ACTIVE",
          },
        },
      },
    });

    const loggedInAccountId = await registerWith(aliasEmail);
    expect(loggedInAccountId).toBe(legacyAccount.id);
  });
});
