import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ThrottlerStorage } from "@nestjs/throttler";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { MAX_INGEST_ATTEMPTS } from "../collectible-images/collectible-images.service";
import { findUnregisteredCatalogUrls } from "../collectible-images/image-catalog";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const STATUS_PATH = "/api/v1/admin/collectible-images/status";
const INGEST_PATH = "/api/v1/admin/collectible-images/ingest";
const STORAGE_PATH = "/api/v1/admin/image-storage-config";

/**
 * SSRF対策で必ず弾かれるURL。外部へ接続しないまま「失敗」を作れる
 * (`image-url-validator`がループバックを拒否する)。CIのネットワークに依存しない。
 */
const BLOCKED_URL = "https://127.0.0.1/blocked.png";

/**
 * カード画像の取り込み状況を管理画面から見て、手動で走らせる
 * (docs/collectible-images.md)。
 *
 * 確かめたいのは、**保管先を設定する前に登録されたカードが取りこぼしとして見える**こと、
 * それを手動実行で対象へ入れられること、そして誰が実行したかが監査ログに残ること。
 */
describe("カード画像の取り込み状況 (管理画面)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let auditorCookie: string[];
  const createdAssetIds: string[] = [];
  const createdUrls: string[] = [];

  async function loginAdmin(role: "SUPER_ADMIN" | "AUDITOR"): Promise<string[]> {
    const email = `e2e-imgingest-${role}-${generateId()}@ovewallet.local`;
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

  /** 保管先が設定済みの状態を作る。実際に外部へ書き込むわけではない。 */
  async function configureStorage() {
    await request(app.getHttpServer())
      .post(STORAGE_PATH)
      .set("Cookie", adminCookie)
      .send({
        bucket: "e2e-bucket",
        endpoint: "https://example.r2.cloudflarestorage.com",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret-value-9876",
        reason: "取り込みテストのため",
      })
      .expect(201);
  }

  /** 取り込み対象へ登録されていないカードを1件作る (保管先設定より前の登録を再現)。 */
  async function createUnregisteredAsset(imageUrl: string) {
    const id = generateId();
    createdAssetIds.push(id);
    createdUrls.push(imageUrl);
    await prisma.collectibleAsset.create({
      data: { id, assetCode: `IMG-E2E-${id}`, name: "取り込みテスト", imageUrl },
    });
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    adminCookie = await loginAdmin("SUPER_ADMIN");
    auditorCookie = await loginAdmin("AUDITOR");
    // 失敗を作るためのカードは1度だけ作る。テストごとに作ると、下の隔離処理が
    // 「取り込み対象外のURL」として先に拾ってしまい、失敗を再現できなくなる。
    await createUnregisteredAsset(BLOCKED_URL);
  });

  beforeEach(async () => {
    resetThrottle();
    await prisma.collectibleImageStorageConfig.deleteMany({});
    await prisma.collectibleImage.deleteMany({});
    // 手動実行はDB全体のカードを見る。他のテストが作ったカードのURLを先に対象外へ
    // しておかないと、この suite が無関係なURLへ実際に通信してしまう。
    //
    // STOREDにしている。打ち切りの戻し (`resetExhausted`) はSTORED以外を戻すので、
    // FAILEDで置くと戻しのテストで一緒に対象へ復活し、結局通信してしまう。
    // sha256を入れていないため配信URLへの差し替えには使われない。
    for (const url of await findUnregisteredCatalogUrls(prisma, 1000)) {
      if (url === BLOCKED_URL) continue; // これはこの suite が使う。
      await prisma.collectibleImage.create({
        data: { id: generateId(), sourceUrl: url, status: "STORED" },
      });
    }
  });

  afterAll(async () => {
    await prisma.collectibleImage.deleteMany({});
    await prisma.collectibleAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
    await prisma.collectibleImageStorageConfig.deleteMany({});
    await app.close();
    await prisma.$disconnect();
  });

  it("保管先が未設定なら、その旨と内訳を返す", async () => {
    const res = await request(app.getHttpServer())
      .get(STATUS_PATH)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(res.body.configured).toBe(false);
    expect(res.body.maxAttempts).toBe(MAX_INGEST_ATTEMPTS);
    expect(res.body.counts).toEqual(
      expect.objectContaining({
        pending: expect.any(Number),
        stored: expect.any(Number),
        failed: expect.any(Number),
        exhausted: expect.any(Number),
        unregistered: expect.any(Number),
      }),
    );
  });

  it("保管先を設定する前に登録したカードが「取り込み対象外」として見える", async () => {
    const url = `https://cdn.example.com/${generateId()}-unregistered.png`;
    const before = await request(app.getHttpServer())
      .get(STATUS_PATH)
      .set("Cookie", adminCookie)
      .expect(200);

    await createUnregisteredAsset(url);

    const after = await request(app.getHttpServer())
      .get(STATUS_PATH)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(after.body.counts.unregistered).toBeGreaterThan(before.body.counts.unregistered);
  });

  it("保管先が未設定なら手動実行は何もしない", async () => {
    const url = `https://cdn.example.com/${generateId()}-noop.png`;
    await createUnregisteredAsset(url);

    const res = await request(app.getHttpServer())
      .post(INGEST_PATH)
      .set("Cookie", adminCookie)
      .send({ reason: "未設定でも押せることの確認" })
      .expect(201);

    // 押しても無反応に見えないよう、実行しなかったことを返す。
    expect(res.body).toEqual({
      configured: false,
      reset: 0,
      registered: 0,
      attempted: 0,
      stored: 0,
    });
    // 取り込めないものを待ち行列へ積まない (試行回数だけが減るのを避ける)。
    expect(await prisma.collectibleImage.findUnique({ where: { sourceUrl: url } })).toBeNull();
  });

  it("手動実行で取りこぼしを対象へ入れ、監査ログに残す", async () => {
    await configureStorage();

    const res = await request(app.getHttpServer())
      .post(INGEST_PATH)
      .set("Cookie", adminCookie)
      .send({ reason: "R2を設定したので取りこぼしを取り込む" })
      .expect(201);

    expect(res.body.configured).toBe(true);
    expect(res.body.registered).toBeGreaterThanOrEqual(1);

    const row = await prisma.collectibleImage.findUniqueOrThrow({
      where: { sourceUrl: BLOCKED_URL },
    });
    // ループバック宛は取得前に弾かれる。失敗の理由が運用者に読める形で残る。
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/rejected/);

    const audit = await prisma.auditLog.findFirst({
      where: { actionType: "COLLECTIBLE_IMAGE_INGEST_RUN" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.reason).toBe("R2を設定したので取りこぼしを取り込む");
    expect(audit?.actorType).toBe("ADMIN");
  });

  it("失敗の理由が状況一覧に出る", async () => {
    await configureStorage();
    await request(app.getHttpServer())
      .post(INGEST_PATH)
      .set("Cookie", adminCookie)
      .send({ reason: "失敗を作る" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(STATUS_PATH)
      .set("Cookie", adminCookie)
      .expect(200);

    const failure = res.body.recentFailures.find(
      (item: { sourceUrl: string }) => item.sourceUrl === BLOCKED_URL,
    );
    expect(failure).toBeDefined();
    expect(failure.lastError).toMatch(/rejected/);
  });

  it("打ち切った分は、チェックを入れたときだけ対象へ戻る", async () => {
    await configureStorage();
    await prisma.collectibleImage.create({
      data: {
        id: generateId(),
        sourceUrl: BLOCKED_URL,
        status: "FAILED",
        attemptCount: MAX_INGEST_ATTEMPTS,
        lastError: "status 404",
      },
    });

    await request(app.getHttpServer())
      .post(INGEST_PATH)
      .set("Cookie", adminCookie)
      .send({ reason: "戻さずに実行" })
      .expect(201);
    let row = await prisma.collectibleImage.findUniqueOrThrow({
      where: { sourceUrl: BLOCKED_URL },
    });
    expect(row.attemptCount).toBe(MAX_INGEST_ATTEMPTS);

    const res = await request(app.getHttpServer())
      .post(INGEST_PATH)
      .set("Cookie", adminCookie)
      .send({ reason: "取得元が直ったので戻す", resetExhausted: true })
      .expect(201);
    expect(res.body.reset).toBeGreaterThanOrEqual(1);

    row = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: BLOCKED_URL } });
    // 戻したうえで同じ実行の中で取得を試みるので、また失敗して1になる。
    expect(row.attemptCount).toBe(1);
  });

  it("実行理由が無ければ拒否する", async () => {
    await request(app.getHttpServer())
      .post(INGEST_PATH)
      .set("Cookie", adminCookie)
      .send({ reason: "" })
      .expect(400);
  });

  it("AUDITORは閲覧できるが実行できない", async () => {
    await request(app.getHttpServer()).get(STATUS_PATH).set("Cookie", auditorCookie).expect(200);
    await request(app.getHttpServer())
      .post(INGEST_PATH)
      .set("Cookie", auditorCookie)
      .send({ reason: "監査役が実行を試みる" })
      .expect(403);
  });

  it("未ログインでは触れない", async () => {
    await request(app.getHttpServer()).get(STATUS_PATH).expect(401);
    await request(app.getHttpServer()).post(INGEST_PATH).send({ reason: "x" }).expect(401);
  });
});
