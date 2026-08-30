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
 * 管理者アカウント管理 (追加・ロール変更・停止/再開・パスワードリセット・自分の
 * パスワード変更)。
 *
 * 導入前は初期投入スクリプトが作る SUPER_ADMIN 1件しか存在できず、6ロールのRBACも
 * 二段階承認 (申請者と承認者に別々の管理者が必要) も実運用できなかった。
 */
describe("管理者アカウント管理", () => {
  let app: INestApplication;
  let superAdminCookie: string[];
  let superAdminId: string;
  const password = "admin-users-e2e-password-123";

  async function login(email: string, pw: string) {
    const res = await request(app.getHttpServer()).post("/api/v1/admin/login").send({ email, password: pw });
    return { status: res.status, cookie: res.headers["set-cookie"] as unknown as string[], body: res.body };
  }

  async function createSuperAdmin(label: string) {
    const email = `admin-users-e2e-${label}-${generateId()}@ovewallet.local`;
    const admin = await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-E2E-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: `E2E ${label}`,
      },
    });
    return { id: admin.id, email };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    // 「最後のSUPER_ADMIN」判定は全体件数を見るため、他テストの管理者が残っていても
    // 影響しないよう、このテストでは常にSUPER_ADMINが複数いる前提で検証する。
    const primary = await createSuperAdmin("primary");
    superAdminId = primary.id;
    await createSuperAdmin("spare");

    const res = await login(primary.email, password);
    expect(res.status).toBe(201);
    superAdminCookie = res.cookie;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("creates an admin, returns the initial password once, and lets the new admin log in", async () => {
    const server = app.getHttpServer();
    const email = `admin-users-e2e-new-${generateId()}@ovewallet.local`;

    const created = await request(server)
      .post("/api/v1/admin/admins")
      .set("Cookie", superAdminCookie)
      .send({ email, displayName: "新任オペレーター", role: "OVE_OPERATOR" })
      .expect(201);

    expect(created.body.initialPassword).toEqual(expect.any(String));
    expect(created.body.admin.adminCode).toMatch(/^OVE-ADM-\d{8}$/);
    expect(created.body.admin.role).toBe("OVE_OPERATOR");
    // ハッシュ・MFAシークレットは決して返さない
    expect(created.body.admin.passwordHash).toBeUndefined();
    expect(created.body.admin.mfaSecretEncrypted).toBeUndefined();

    // 発行された初期パスワードで実際にログインできる
    const loggedIn = await login(email, created.body.initialPassword);
    expect(loggedIn.status).toBe(201);

    // 一覧にも現れ、ハッシュは含まれない
    const list = await request(server).get("/api/v1/admin/admins").set("Cookie", superAdminCookie).expect(200);
    const found = list.body.find((a: { email: string }) => a.email === email);
    expect(found).toBeDefined();
    expect(found.passwordHash).toBeUndefined();
  });

  it("rejects creating an admin with a duplicate email", async () => {
    const server = app.getHttpServer();
    const email = `admin-users-e2e-dup-${generateId()}@ovewallet.local`;
    const payload = { email, displayName: "重複テスト", role: "VIEWER" };

    await request(server).post("/api/v1/admin/admins").set("Cookie", superAdminCookie).send(payload).expect(201);
    await request(server).post("/api/v1/admin/admins").set("Cookie", superAdminCookie).send(payload).expect(409);
  });

  it("suspends an admin and blocks their existing session immediately", async () => {
    const server = app.getHttpServer();
    const email = `admin-users-e2e-suspend-${generateId()}@ovewallet.local`;

    const created = await request(server)
      .post("/api/v1/admin/admins")
      .set("Cookie", superAdminCookie)
      .send({ email, displayName: "退職予定者", role: "OVE_OPERATOR" })
      .expect(201);

    const target = await login(email, created.body.initialPassword);
    expect(target.status).toBe(201);
    // 停止前は自分の情報を参照できる
    await request(server).get("/api/v1/admin/me").set("Cookie", target.cookie).expect(200);

    await request(server)
      .patch(`/api/v1/admin/admins/${created.body.admin.id}`)
      .set("Cookie", superAdminCookie)
      .send({ status: "SUSPENDED", reason: "退職のため" })
      .expect(200);

    // ログアウトを待たずに既存セッションが無効になる (AdminAuthGuardが毎回DBを見るため)
    await request(server).get("/api/v1/admin/me").set("Cookie", target.cookie).expect(401);
    // 再ログインもできない
    const relogin = await login(email, created.body.initialPassword);
    expect(relogin.status).toBe(401);
  });

  it("changes a role and records an audit log", async () => {
    const server = app.getHttpServer();
    const email = `admin-users-e2e-role-${generateId()}@ovewallet.local`;

    const created = await request(server)
      .post("/api/v1/admin/admins")
      .set("Cookie", superAdminCookie)
      .send({ email, displayName: "ロール変更対象", role: "VIEWER" })
      .expect(201);

    const updated = await request(server)
      .patch(`/api/v1/admin/admins/${created.body.admin.id}`)
      .set("Cookie", superAdminCookie)
      .send({ role: "AUDITOR", reason: "監査担当へ変更" })
      .expect(200);
    expect(updated.body.role).toBe("AUDITOR");

    const log = await prisma.auditLog.findFirst({
      where: { targetType: "admin_user", targetId: created.body.admin.id, actionType: "ADMIN_USER_UPDATE" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(superAdminId);
  });

  it("refuses to let an admin change their own role or suspend themselves", async () => {
    const server = app.getHttpServer();

    await request(server)
      .patch(`/api/v1/admin/admins/${superAdminId}`)
      .set("Cookie", superAdminCookie)
      .send({ role: "VIEWER" })
      .expect(400);

    await request(server)
      .patch(`/api/v1/admin/admins/${superAdminId}`)
      .set("Cookie", superAdminCookie)
      .send({ status: "SUSPENDED" })
      .expect(400);
  });

  it("resets another admin's password and invalidates the old one", async () => {
    const server = app.getHttpServer();
    const email = `admin-users-e2e-reset-${generateId()}@ovewallet.local`;

    const created = await request(server)
      .post("/api/v1/admin/admins")
      .set("Cookie", superAdminCookie)
      .send({ email, displayName: "パスワード紛失", role: "OVE_OPERATOR" })
      .expect(201);

    const reset = await request(server)
      .post(`/api/v1/admin/admins/${created.body.admin.id}/reset-password`)
      .set("Cookie", superAdminCookie)
      .send({ reason: "本人がパスワードを紛失したため" })
      .expect(201);

    expect(reset.body.newPassword).toEqual(expect.any(String));
    expect(reset.body.newPassword).not.toBe(created.body.initialPassword);

    const withNew = await login(email, reset.body.newPassword);
    expect(withNew.status).toBe(201);
    const withOld = await login(email, created.body.initialPassword);
    expect(withOld.status).toBe(401);
  });

  it("lets an admin change their own password", async () => {
    const server = app.getHttpServer();
    const email = `admin-users-e2e-selfpw-${generateId()}@ovewallet.local`;

    const created = await request(server)
      .post("/api/v1/admin/admins")
      .set("Cookie", superAdminCookie)
      .send({ email, displayName: "自分で変更", role: "VIEWER" })
      .expect(201);

    const session = await login(email, created.body.initialPassword);
    const newPassword = "my-own-new-password-2026";

    // 現在のパスワードが違えば拒否される
    await request(server)
      .post("/api/v1/admin/password")
      .set("Cookie", session.cookie)
      .send({ currentPassword: "wrong-password", newPassword })
      .expect(401);

    // 短すぎるパスワードは拒否される
    await request(server)
      .post("/api/v1/admin/password")
      .set("Cookie", session.cookie)
      .send({ currentPassword: created.body.initialPassword, newPassword: "short" })
      .expect(400);

    await request(server)
      .post("/api/v1/admin/password")
      .set("Cookie", session.cookie)
      .send({ currentPassword: created.body.initialPassword, newPassword })
      .expect(201);

    expect((await login(email, newPassword)).status).toBe(201);
    expect((await login(email, created.body.initialPassword)).status).toBe(401);
  });

  it("always leaves at least one active SUPER_ADMIN, even after demoting every other one", async () => {
    const server = app.getHttpServer();

    // 操作者以外の有効なSUPER_ADMINを片端から降格しても、操作者自身は自己操作の禁止に
    // より降格・停止できないため、有効なSUPER_ADMINが0人になることはない。
    // 他のテストファイルが作った管理者を巻き込まないよう、対象はこのファイルが作った分に絞る。
    const others = await prisma.adminUser.findMany({
      where: {
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        id: { not: superAdminId },
        email: { startsWith: "admin-users-e2e-" },
      },
      select: { id: true },
    });
    for (const other of others) {
      await request(server)
        .patch(`/api/v1/admin/admins/${other.id}`)
        .set("Cookie", superAdminCookie)
        .send({ role: "VIEWER", reason: "不変条件の検証" })
        .expect(200);
    }

    // 操作者が唯一の有効なSUPER_ADMINになった状態で、自分を降格・停止しようとしても拒否される
    await request(server)
      .patch(`/api/v1/admin/admins/${superAdminId}`)
      .set("Cookie", superAdminCookie)
      .send({ role: "VIEWER" })
      .expect(400);
    await request(server)
      .patch(`/api/v1/admin/admins/${superAdminId}`)
      .set("Cookie", superAdminCookie)
      .send({ status: "SUSPENDED" })
      .expect(400);

    const activeSuperAdmins = await prisma.adminUser.count({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
    });
    expect(activeSuperAdmins).toBeGreaterThanOrEqual(1);

    // 操作者は引き続き管理者を追加できる (ロックアウトしていない)
    await request(server)
      .post("/api/v1/admin/admins")
      .set("Cookie", superAdminCookie)
      .send({
        email: `admin-users-e2e-recover-${generateId()}@ovewallet.local`,
        displayName: "復旧確認",
        role: "SUPER_ADMIN",
      })
      .expect(201);
  });

  it("denies admin management to non-SUPER_ADMIN roles", async () => {
    const server = app.getHttpServer();
    const email = `admin-users-e2e-rbac-${generateId()}@ovewallet.local`;

    const created = await request(server)
      .post("/api/v1/admin/admins")
      .set("Cookie", superAdminCookie)
      .send({ email, displayName: "権限なし", role: "OVE_OPERATOR" })
      .expect(201);

    const session = await login(email, created.body.initialPassword);

    await request(server).get("/api/v1/admin/admins").set("Cookie", session.cookie).expect(403);
    await request(server)
      .post("/api/v1/admin/admins")
      .set("Cookie", session.cookie)
      .send({ email: `nope-${generateId()}@ovewallet.local`, displayName: "x", role: "VIEWER" })
      .expect(403);
    await request(server)
      .patch(`/api/v1/admin/admins/${superAdminId}`)
      .set("Cookie", session.cookie)
      .send({ role: "VIEWER" })
      .expect(403);

    // 自分のパスワード変更はロールを問わず可能
    await request(server)
      .post("/api/v1/admin/password")
      .set("Cookie", session.cookie)
      .send({ currentPassword: created.body.initialPassword, newPassword: "operator-new-password-2026" })
      .expect(201);
  });
});
