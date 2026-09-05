import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ThrottlerStorage } from "@nestjs/throttler";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { MAIL_CONFIG_ID } from "../mail/mail-config.service";

/**
 * メール送信設定を管理画面から変更する (docs/login-methods.md)。
 *
 * 確かめたいのは、鍵が**画面から出て行かない**ことと、テスト送信の結果が
 * 「何を直せばよいか」の分かる形で返ること。
 */
describe("メール送信設定 (管理画面)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let auditorCookie: string[];

  async function loginAdmin(role: "SUPER_ADMIN" | "AUDITOR"): Promise<string[]> {
    const email = `e2e-mailcfg-${role}-${generateId()}@ovewallet.local`;
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

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    adminCookie = await loginAdmin("SUPER_ADMIN");
    auditorCookie = await loginAdmin("AUDITOR");
  });

  beforeEach(async () => {
    resetThrottle();
    await prisma.mailConfig.deleteMany({ where: { id: MAIL_CONFIG_ID } });
  });

  afterAll(async () => {
    await prisma.mailConfig.deleteMany({ where: { id: MAIL_CONFIG_ID } });
    await app.close();
    await prisma.$disconnect();
  });

  describe("APIキーの保存", () => {
    it("保存すると末尾4文字だけのマスク表示になり、生値は返らない", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_secret_key_abcd", mailFrom: "no-reply@example.com", reason: "e2e" })
        .expect(201);

      expect(res.body.apiKeySet).toBe(true);
      expect(res.body.apiKeyPreview).toBe("**************abcd");
      expect(res.body.mailFrom).toBe("no-reply@example.com");
      expect(JSON.stringify(res.body)).not.toContain("re_secret_key_abcd");
    });

    it("参照しても生値は返らない", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_secret_key_wxyz", reason: "e2e" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain("re_secret_key_wxyz");
      expect(res.body.apiKeyPreview).toBe("**************wxyz");
    });

    it("DBには暗号化して保存する (生値をそのまま置かない)", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_plaintext_check", reason: "e2e" })
        .expect(201);

      const row = await prisma.mailConfig.findUniqueOrThrow({ where: { id: MAIL_CONFIG_ID } });
      expect(row.apiKeyEncrypted).not.toContain("re_plaintext_check");
      expect(row.apiKeyPreview).not.toContain("re_plaintext_check");
    });

    it("APIキーを空欄で保存しても現在の鍵は消えない", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_keep_me_1234", reason: "e2e" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ mailFrom: "changed@example.com", reason: "差出人だけ変更" })
        .expect(201);

      expect(res.body.apiKeySet).toBe(true);
      expect(res.body.apiKeyPreview).toBe("***********1234");
      expect(res.body.mailFrom).toBe("changed@example.com");
    });

    it("変更は監査ログに残るが、鍵そのものは残さない", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_audit_check_99", reason: "鍵の初期設定" })
        .expect(201);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { actionType: "MAIL_CONFIG_UPDATED" },
        orderBy: { createdAt: "desc" },
      });
      expect(log.reason).toBe("鍵の初期設定");
      expect(JSON.stringify(log.afterData)).not.toContain("re_audit_check_99");
    });

    it("理由なしでは保存できない", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_no_reason" })
        .expect(400);
    });
  });

  describe("権限", () => {
    it("AUDITORは参照できるが変更もテスト送信もできない", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/mail-config")
        .set("Cookie", auditorCookie)
        .expect(200);

      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", auditorCookie)
        .send({ apiKey: "re_x", reason: "e2e" })
        .expect(403);

      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config/test")
        .set("Cookie", auditorCookie)
        .send({ to: "someone@example.com" })
        .expect(403);
    });

    it("ログインしていなければ何もできない", async () => {
      await request(app.getHttpServer()).get("/api/v1/admin/mail-config").expect(401);
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .send({ apiKey: "re_x", reason: "e2e" })
        .expect(401);
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config/test")
        .send({ to: "someone@example.com" })
        .expect(401);
    });
  });

  describe("テスト送信", () => {
    it("未設定なら送らず、何をすればよいかを返す", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config/test")
        .set("Cookie", adminCookie)
        .send({ to: "someone@example.com" })
        .expect(201);

      expect(res.body.outcome).toBe("not_configured");
      expect(res.body.message).toContain("APIキー");
    });

    it("送信できれば成功として返し、監査ログに宛先が残る", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_test_ok", reason: "e2e" })
        .expect(201);

      // 実際にResendへ出さないよう、HTTPの1段だけ差し替える
      const originalFetch = global.fetch;
      global.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
      try {
        const res = await request(app.getHttpServer())
          .post("/api/v1/admin/mail-config/test")
          .set("Cookie", adminCookie)
          .send({ to: "someone@example.com" })
          .expect(201);
        expect(res.body.outcome).toBe("ok");
      } finally {
        global.fetch = originalFetch;
      }

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { actionType: "MAIL_TEST_SENT" },
        orderBy: { createdAt: "desc" },
      });
      expect(log.result).toBe("SUCCESS");
      expect(log.reason).toContain("someone@example.com");
    });

    it("失敗したら理由を返し、監査ログはFAILUREになる", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_test_ng", reason: "e2e" })
        .expect(201);

      const originalFetch = global.fetch;
      global.fetch = (async () =>
        new Response(JSON.stringify({ name: "validation_error" }), { status: 422 })) as unknown as typeof fetch;
      try {
        const res = await request(app.getHttpServer())
          .post("/api/v1/admin/mail-config/test")
          .set("Cookie", adminCookie)
          .send({ to: "someone@example.com" })
          .expect(201);

        expect(res.body.outcome).toBe("failed");
        expect(res.body.message).not.toContain("re_test_ng");
      } finally {
        global.fetch = originalFetch;
      }

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { actionType: "MAIL_TEST_SENT" },
        orderBy: { createdAt: "desc" },
      });
      expect(log.result).toBe("FAILURE");
    });

    it("テストメールにワンタイムコードは含めない", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/mail-config")
        .set("Cookie", adminCookie)
        .send({ apiKey: "re_body_check", reason: "e2e" })
        .expect(201);

      let sentBody: Record<string, unknown> = {};
      const originalFetch = global.fetch;
      global.fetch = (async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch;
      try {
        await request(app.getHttpServer())
          .post("/api/v1/admin/mail-config/test")
          .set("Cookie", adminCookie)
          .send({ to: "someone@example.com" })
          .expect(201);
      } finally {
        global.fetch = originalFetch;
      }

      expect(sentBody.subject).toContain("送信テスト");
      expect(String(sentBody.text)).not.toMatch(/\d{6}/);
    });

    it("連続したテスト送信は打ち切る", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post("/api/v1/admin/mail-config/test")
          .set("Cookie", adminCookie)
          .send({ to: "someone@example.com" });
        statuses.push(res.status);
      }
      expect(statuses).toContain(429);
    });
  });

  describe("ログイン画面への反映", () => {
    it("送信の設定が済むまでメールの選択肢を出さない", async () => {
      // 押してもコードが届かないボタンを見せない
      process.env.ENABLE_EMAIL_LOGIN = "true";
      const savedEnvKey = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;
      try {
        const before = await request(app.getHttpServer()).get("/api/v1/auth/methods").expect(200);
        expect(before.body.email).toBe(false);

        await request(app.getHttpServer())
          .post("/api/v1/admin/mail-config")
          .set("Cookie", adminCookie)
          .send({ apiKey: "re_now_configured", reason: "e2e" })
          .expect(201);

        const after = await request(app.getHttpServer()).get("/api/v1/auth/methods").expect(200);
        expect(after.body.email).toBe(true);
      } finally {
        if (savedEnvKey !== undefined) process.env.RESEND_API_KEY = savedEnvKey;
      }
    });
  });
});
