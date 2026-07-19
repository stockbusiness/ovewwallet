import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/** 監査ログCSVエクスポート (docs/admin-operations.md参照)。 */
describe("GET /api/v1/admin/audit-logs/export", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-audit-export-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Audit Export Admin",
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("CSVヘッダー・UTF-8 BOM・監査ログの内容を含むCSVを返す", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const login = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);

    // 全セッション無効化 (ACCOUNT_SESSIONS_REVOKED) は必ず監査ログを1件作成するため、
    // 内容確認用のテストデータとして使う (通常の個別付与は高額でなければ監査ログを
    // 作成しないため、確実に監査ログが残る操作を選んでいる)。
    await request(server)
      .post(`/api/v1/admin/accounts/${login.body.ove_account_id}/revoke-sessions`)
      .set("Cookie", adminCookie)
      .expect(201);

    const res = await request(server).get("/api/v1/admin/audit-logs/export").set("Cookie", adminCookie).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("audit-logs.csv");

    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("日時,実行者種別,実行者ID,操作種別,対象種別,対象ID,結果,理由,IPアドレス");
    expect(lines.some((line) => line.includes(login.body.ove_account_id) && line.includes("ACCOUNT_SESSIONS_REVOKED"))).toBe(
      true,
    );
  });

  it("targetTypeで絞り込める", async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .get("/api/v1/admin/audit-logs/export?targetType=wallet")
      .set("Cookie", adminCookie)
      .expect(200);
    const lines = res.text.slice(1).trim().split("\r\n").slice(1);
    for (const line of lines) {
      expect(line.split(",")[4]).toBe("wallet");
    }
  });
});
