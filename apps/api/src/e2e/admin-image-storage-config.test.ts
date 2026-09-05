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

const PATH = "/api/v1/admin/image-storage-config";

/**
 * カード画像の保管先設定を管理画面から編集する (docs/collectible-images.md)。
 *
 * 確かめたいのは、**シークレットが画面から出て行かない**ことと、
 * 誰が何をしたかが監査ログに残ること。
 */
describe("カード画像の保管先設定 (管理画面)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let auditorCookie: string[];

  async function loginAdmin(role: "SUPER_ADMIN" | "AUDITOR"): Promise<string[]> {
    const email = `e2e-imgstore-${role}-${generateId()}@ovewallet.local`;
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
    await prisma.collectibleImageStorageConfig.deleteMany({});
  });

  afterAll(async () => {
    await prisma.collectibleImageStorageConfig.deleteMany({});
    await app.close();
    await prisma.$disconnect();
  });

  it("保存して読み出せる", async () => {
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({
        bucket: "test-bucket",
        endpoint: "https://example.r2.cloudflarestorage.com",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret-value-9876",
        reason: "R2バケットを作成したため",
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get(PATH).set("Cookie", adminCookie).expect(200);
    expect(res.body).toMatchObject({
      configured: true,
      bucket: "test-bucket",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKeySet: true,
    });
  });

  it("シークレットの生値はレスポンスに含まれない", async () => {
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "never-show-this-1234",
        reason: "初期設定",
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get(PATH).set("Cookie", adminCookie).expect(200);
    expect(JSON.stringify(res.body)).not.toContain("never-show-this-1234");
    expect(res.body.secretAccessKeyPreview).toBe("****************1234");
  });

  it("シークレットを空欄で保存しても現在の値を消さない", async () => {
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ bucket: "b", accessKeyId: "k", secretAccessKey: "keep-me-please", reason: "初期設定" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ bucket: "b2", reason: "バケット名だけ変更" })
      .expect(201);

    expect(res.body.secretAccessKeySet).toBe(true);
    expect(res.body.bucket).toBe("b2");
  });

  it("変更理由が無ければ保存できない", async () => {
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({ bucket: "b" })
      .expect(400);
  });

  it("変更が監査ログに残り、鍵の生値は残らない", async () => {
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", adminCookie)
      .send({
        bucket: "audited-bucket",
        accessKeyId: "k",
        secretAccessKey: "must-not-be-logged",
        reason: "監査ログ確認",
      })
      .expect(201);

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "COLLECTIBLE_IMAGE_STORAGE_CONFIG_UPDATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(log.reason).toBe("監査ログ確認");
    expect(JSON.stringify(log.afterData)).toContain("audited-bucket");
    expect(JSON.stringify(log)).not.toContain("must-not-be-logged");
  });

  it("未設定のまま接続テストすると not_configured を返す", async () => {
    const res = await request(app.getHttpServer())
      .post(`${PATH}/test`)
      .set("Cookie", adminCookie)
      .expect(201);

    expect(res.body.outcome).toBe("not_configured");
    expect(res.body.bucket).toBeNull();
  });

  it("接続テストの結果も監査ログに残る", async () => {
    await request(app.getHttpServer()).post(`${PATH}/test`).set("Cookie", adminCookie).expect(201);

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "COLLECTIBLE_IMAGE_STORAGE_TESTED" },
      orderBy: { createdAt: "desc" },
    });
    expect(log.result).toBe("FAILURE");
  });

  it("AUDITOR は閲覧できるが変更も接続テストもできない", async () => {
    await request(app.getHttpServer()).get(PATH).set("Cookie", auditorCookie).expect(200);
    await request(app.getHttpServer())
      .post(PATH)
      .set("Cookie", auditorCookie)
      .send({ bucket: "b", reason: "権限確認" })
      .expect(403);
    await request(app.getHttpServer()).post(`${PATH}/test`).set("Cookie", auditorCookie).expect(403);
  });

  it("ログインしていないと触れない", async () => {
    await request(app.getHttpServer()).get(PATH).expect(401);
    await request(app.getHttpServer()).post(PATH).send({ bucket: "b", reason: "x" }).expect(401);
    await request(app.getHttpServer()).post(`${PATH}/test`).expect(401);
  });
});
