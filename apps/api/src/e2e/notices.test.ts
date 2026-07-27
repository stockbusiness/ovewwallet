import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/** お知らせの作成 (重要度込み)・ユーザー向け一覧・既読管理 (docs/notices-read-tracking.md参照)。 */
describe("お知らせの重要度・既読管理", () => {
  let app: INestApplication;
  let adminEmail: string;
  const adminPassword = "e2e-test-password-123";

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    adminEmail = `e2e-notices-admin-${generateId()}@ovewallet.local`;
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Notices Admin",
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("重要度を指定して作成でき、ユーザー向け一覧にも反映される", async () => {
    const server = app.getHttpServer();

    const adminLogin = await request(server)
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    const adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];

    const created = await request(server)
      .post("/api/v1/admin/notices")
      .set("Cookie", adminCookie)
      .send({ title: "メンテナンスのお知らせ", message: "本日メンテナンスを行います", importance: "IMPORTANT" })
      .expect(201);
    expect(created.body.importance).toBe("IMPORTANT");

    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server)
      .post("/api/v1/auth/line/login")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    const userCookie = userLogin.headers["set-cookie"] as unknown as string[];

    const list = await request(server).get("/api/v1/me/notices").set("Cookie", userCookie).expect(200);
    const notice = list.body.find((n: { id: string }) => n.id === created.body.id);
    expect(notice).toBeDefined();
    expect(notice.importance).toBe("IMPORTANT");
    expect(notice.is_read).toBe(false);
  });

  it("既読にすると is_read が true になり、別アカウントの既読状態には影響しない", async () => {
    const server = app.getHttpServer();

    const adminLogin = await request(server)
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    const adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];

    const created = await request(server)
      .post("/api/v1/admin/notices")
      .set("Cookie", adminCookie)
      .send({ title: "既読テスト用お知らせ", message: "本文" })
      .expect(201);
    expect(created.body.importance).toBe("NORMAL");

    const idTokenA = `mock.${generateId()}`;
    const loginA = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenA, termsAccepted: true }).expect(201);
    const cookieA = loginA.headers["set-cookie"] as unknown as string[];

    const idTokenB = `mock.${generateId()}`;
    const loginB = await request(server).post("/api/v1/auth/line/login").send({ idToken: idTokenB, termsAccepted: true }).expect(201);
    const cookieB = loginB.headers["set-cookie"] as unknown as string[];

    await request(server).post(`/api/v1/me/notices/${created.body.id}/read`).set("Cookie", cookieA).expect(201);

    const listA = await request(server).get("/api/v1/me/notices").set("Cookie", cookieA).expect(200);
    const noticeA = listA.body.find((n: { id: string }) => n.id === created.body.id);
    expect(noticeA.is_read).toBe(true);

    const listB = await request(server).get("/api/v1/me/notices").set("Cookie", cookieB).expect(200);
    const noticeB = listB.body.find((n: { id: string }) => n.id === created.body.id);
    expect(noticeB.is_read).toBe(false);

    // 二重に既読にしても冪等 (エラーにならない)
    await request(server).post(`/api/v1/me/notices/${created.body.id}/read`).set("Cookie", cookieA).expect(201);
  });

  it("予約投稿 (未来のpublishedAt) はその日時になるまでユーザー向け一覧に含まれない", async () => {
    const server = app.getHttpServer();

    const adminLogin = await request(server)
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    const adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];

    const futurePublishedAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const scheduled = await request(server)
      .post("/api/v1/admin/notices")
      .set("Cookie", adminCookie)
      .send({ title: "予約投稿テスト", message: "明日公開されるはずのお知らせ", publishedAt: futurePublishedAt })
      .expect(201);
    expect(new Date(scheduled.body.publishedAt).toISOString()).toBe(futurePublishedAt);

    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const userCookie = userLogin.headers["set-cookie"] as unknown as string[];

    const list = await request(server).get("/api/v1/me/notices").set("Cookie", userCookie).expect(200);
    expect(list.body.find((n: { id: string }) => n.id === scheduled.body.id)).toBeUndefined();

    // 管理画面の一覧には (公開前でも) 表示される。
    const adminList = await request(server).get("/api/v1/admin/notices").set("Cookie", adminCookie).expect(200);
    expect(adminList.body.find((n: { id: string }) => n.id === scheduled.body.id)).toBeDefined();
  });

  it("publishedAtを指定しない場合は即時公開される", async () => {
    const server = app.getHttpServer();

    const adminLogin = await request(server)
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    const adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];

    const created = await request(server)
      .post("/api/v1/admin/notices")
      .set("Cookie", adminCookie)
      .send({ title: "即時公開テスト", message: "本文" })
      .expect(201);

    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const userCookie = userLogin.headers["set-cookie"] as unknown as string[];

    const list = await request(server).get("/api/v1/me/notices").set("Cookie", userCookie).expect(200);
    expect(list.body.find((n: { id: string }) => n.id === created.body.id)).toBeDefined();
  });
});
