import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { computeTotpCode, hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 失敗ロックのTOTP段階。
 *
 * `mfaToken`はコードを間違えても消えないため、ここを数えないと「パスワードは知っている」
 * 相手にトークンの有効期間(5分)いっぱいの総当たりを許すことになる。6桁のコードに対し、
 * IP制限だけでは複数IPからの試行を止められない。
 *
 * `admin-login-lockout.test.ts` と別ファイルにしているのは、ログイン系のIP制限
 * (60秒10回) を共有しないため (テストファイルごとにアプリを作り直すため枠も分かれる)。
 */
describe("管理者ログインの失敗ロック (TOTP段階)", () => {
  let app: INestApplication;
  const password = "mfa-lockout-e2e-password-123";
  const maxFailures = 2;
  const originalMaxFailures = process.env.ADMIN_LOGIN_MAX_FAILURES;

  beforeAll(async () => {
    process.env.ADMIN_LOGIN_MAX_FAILURES = String(maxFailures);
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    if (originalMaxFailures === undefined) delete process.env.ADMIN_LOGIN_MAX_FAILURES;
    else process.env.ADMIN_LOGIN_MAX_FAILURES = originalMaxFailures;
    await app.close();
    await prisma.$disconnect();
  });

  it("TOTPコードを連続して間違えるとロックし、正しいコードも通さない", async () => {
    const server = app.getHttpServer();
    const email = `mfa-lockout-admin-${generateId()}@ovewallet.local`;
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-MFALOCK-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "MFA Lockout E2E Admin",
      },
    });

    // MFAを有効化する
    const first = await request(server).post("/api/v1/admin/login").send({ email, password }).expect(201);
    const cookie = first.headers["set-cookie"] as unknown as string[];
    const setup = await request(server).post("/api/v1/admin/mfa/setup").set("Cookie", cookie).expect(201);
    const secret = setup.body.secret as string;
    await request(server)
      .post("/api/v1/admin/mfa/enable")
      .set("Cookie", cookie)
      .send({ code: computeTotpCode(secret) })
      .expect(201);

    // 1段階目は通し、2段階目のコードだけを間違え続ける
    const challenge = await request(server).post("/api/v1/admin/login").send({ email, password }).expect(201);
    const mfaToken = challenge.body.mfaToken as string;
    expect(mfaToken).toBeDefined();

    for (let i = 0; i < maxFailures; i++) {
      await request(server).post("/api/v1/admin/login/mfa").send({ mfaToken, code: "000000" }).expect(401);
    }

    await request(server)
      .post("/api/v1/admin/login/mfa")
      .send({ mfaToken, code: computeTotpCode(secret) })
      .expect(429);
  });
});
