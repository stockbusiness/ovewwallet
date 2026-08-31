import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 管理者ログインのアカウント単位の失敗ロック (パスワード段階)。
 *
 * 導入前の制限はIPベースのみで、IPを変えれば1アカウントへの試行回数に上限が無かった。
 *
 * IP制限 (ログイン系は60秒10回、`rate-limit.test.ts`で検証) を消費し切ると、
 * アカウントロックとIP制限のどちらで429になったのか区別できなくなる。そのため
 * このファイルは `/api/v1/admin/login` への呼び出しを10回未満に収めてある
 * (失敗上限も2回に下げている)。2段階目(TOTP)の検証は別ファイルに分けており、
 * これも同じ理由 (テストファイルごとにアプリを作り直すため制限枠も分かれる)。
 */
describe("管理者ログインの失敗ロック", () => {
  let app: INestApplication;
  const password = "lockout-e2e-password-123";
  const maxFailures = 2;
  const originalMaxFailures = process.env.ADMIN_LOGIN_MAX_FAILURES;

  async function createAdmin(): Promise<string> {
    const email = `lockout-admin-${generateId()}@ovewallet.local`;
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-LOCK-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "Lockout E2E Admin",
      },
    });
    return email;
  }

  function login(email: string, pw: string) {
    return request(app.getHttpServer()).post("/api/v1/admin/login").send({ email, password: pw });
  }

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

  // 呼び出し回数: 2 (誤) + 1 (正・429) + 1 (別管理者) = 4
  it("連続して間違えるとロックし、正しいパスワードも通さない (他の管理者には波及しない)", async () => {
    const email = await createAdmin();
    const other = await createAdmin();
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email } });

    for (let i = 0; i < maxFailures; i++) {
      await login(email, "wrong-password").expect(401);
    }

    // ロック後は正しいパスワードでも通さない。ここを通すと、総当たりで当たった
    // 瞬間に入られてしまい回数を数える意味が無くなる。
    await login(email, password).expect(429);

    // ロック時のみ監査ログを残す (失敗のたびに書くと総当たりでaudit_logsが膨れる)
    const log = await prisma.auditLog.findFirst({
      where: { actorId: admin.id, actionType: "ADMIN_LOGIN_LOCKED" },
    });
    expect(log).not.toBeNull();
    expect(log?.result).toBe("FAILURE");

    // 同じIPからでも、別の管理者は通常どおりログインできる
    await login(other, password).expect(201);
  });

  // 呼び出し回数: 1 (誤) + 1 (正) + 1 (誤) = 3。合計7回でIP制限(10回)に収まる。
  it("ログインに成功すると失敗回数が消える (連続失敗のみを数える)", async () => {
    const email = await createAdmin();

    await login(email, "wrong-password").expect(401);
    await login(email, password).expect(201);

    // 通算の失敗は上限に達するが、間に成功を挟んでいるのでロックされない
    // (429ではなく401が返ることが、回数が0に戻った証拠になる)
    await login(email, "wrong-password").expect(401);
  });
});
