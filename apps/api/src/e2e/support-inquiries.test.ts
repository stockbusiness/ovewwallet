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

const MINE_PATH = "/api/v1/me/support-inquiries";
const ADMIN_PATH = "/api/v1/admin/support-inquiries";

/**
 * 利用者からの問い合わせ (docs/support-inquiries.md)。
 *
 * 確かめたいのは、**アカウントが自己申告ではなくセッションから決まる**こと、
 * **運用メモが利用者へ漏れない**こと、返信が本人にだけ届くこと。
 */
describe("お問い合わせ", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let auditorCookie: string[];
  const createdAccountIds: string[] = [];

  async function loginAdmin(role: "SUPER_ADMIN" | "AUDITOR"): Promise<string[]> {
    const email = `e2e-support-${role}-${generateId()}@ovewallet.local`;
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

  /** 利用者としてログインする。 */
  async function loginUser(): Promise<{ cookie: string[]; oveAccountId: string }> {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken: `mock.e2e-support-${generateId()}`, termsAccepted: true })
      .expect(201);
    createdAccountIds.push(res.body.ove_account_id);
    return {
      cookie: res.headers["set-cookie"] as unknown as string[],
      oveAccountId: res.body.ove_account_id,
    };
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

  beforeEach(() => {
    resetThrottle();
  });

  afterAll(async () => {
    await prisma.supportInquiry.deleteMany({ where: { oveAccountId: { in: createdAccountIds } } });
    await prisma.notice.deleteMany({ where: { oveAccountId: { in: createdAccountIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("送るとアカウントが自動で紐付き、受付番号が返る", async () => {
    const user = await loginUser();
    const res = await request(app.getHttpServer())
      .post(MINE_PATH)
      .set("Cookie", user.cookie)
      .send({ category: "REWARD_NOT_GRANTED", message: "登録したのにORIが入っていません" })
      .expect(201);

    expect(res.body.inquiry_code).toMatch(/^OVE-INQ-\d{6}$/);
    expect(res.body.status).toBe("OPEN");

    // 誰の問い合わせかは、利用者の自己申告ではなくセッションから決まる。
    const saved = await prisma.supportInquiry.findFirstOrThrow({
      where: { inquiryCode: res.body.inquiry_code },
    });
    expect(saved.oveAccountId).toBe(user.oveAccountId);
  });

  it("自分の問い合わせだけが見え、他人のものは見えない", async () => {
    const alice = await loginUser();
    const bob = await loginUser();
    await request(app.getHttpServer())
      .post(MINE_PATH)
      .set("Cookie", alice.cookie)
      .send({ category: "OTHER", message: "アリスの相談" })
      .expect(201);

    const mine = await request(app.getHttpServer())
      .get(MINE_PATH)
      .set("Cookie", bob.cookie)
      .expect(200);
    expect(mine.body).toEqual([]);
  });

  it("同じ内容を続けて送っても二重に登録しない", async () => {
    const user = await loginUser();
    const payload = { category: "BALANCE_MISMATCH", message: "残高が合いません" };
    await request(app.getHttpServer()).post(MINE_PATH).set("Cookie", user.cookie).send(payload).expect(201);
    await request(app.getHttpServer()).post(MINE_PATH).set("Cookie", user.cookie).send(payload).expect(400);

    expect(await prisma.supportInquiry.count({ where: { oveAccountId: user.oveAccountId } })).toBe(1);
  });

  it("空の本文は受け付けない", async () => {
    const user = await loginUser();
    await request(app.getHttpServer())
      .post(MINE_PATH)
      .set("Cookie", user.cookie)
      .send({ category: "OTHER", message: "   " })
      .expect(400);
  });

  it("未ログインでは送れない", async () => {
    await request(app.getHttpServer())
      .post(MINE_PATH)
      .send({ category: "OTHER", message: "誰でしょう" })
      .expect(401);
  });

  it("返信すると本人だけに見えるお知らせが届き、他人には届かない", async () => {
    const user = await loginUser();
    const other = await loginUser();
    const created = await request(app.getHttpServer())
      .post(MINE_PATH)
      .set("Cookie", user.cookie)
      .send({ category: "REWARD_NOT_GRANTED", message: "付与を確認してください" })
      .expect(201);
    const inquiry = await prisma.supportInquiry.findFirstOrThrow({
      where: { inquiryCode: created.body.inquiry_code },
    });

    await request(app.getHttpServer())
      .post(`${ADMIN_PATH}/${inquiry.id}/reply`)
      .set("Cookie", adminCookie)
      .send({ title: "ご確認しました", message: "本日付与しました。" })
      .expect(201);

    const mine = await request(app.getHttpServer())
      .get("/api/v1/me/notices")
      .set("Cookie", user.cookie)
      .expect(200);
    expect(mine.body.some((n: { title: string }) => n.title === "ご確認しました")).toBe(true);

    const others = await request(app.getHttpServer())
      .get("/api/v1/me/notices")
      .set("Cookie", other.cookie)
      .expect(200);
    expect(others.body.some((n: { title: string }) => n.title === "ご確認しました")).toBe(false);

    const after = await prisma.supportInquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(after.status).toBe("ANSWERED");
    expect(after.replyNoticeId).not.toBeNull();
  });

  it("運用メモは利用者向けの経路に出ない", async () => {
    const user = await loginUser();
    const created = await request(app.getHttpServer())
      .post(MINE_PATH)
      .set("Cookie", user.cookie)
      .send({ category: "OTHER", message: "メモ漏れの確認" })
      .expect(201);
    const inquiry = await prisma.supportInquiry.findFirstOrThrow({
      where: { inquiryCode: created.body.inquiry_code },
    });

    await request(app.getHttpServer())
      .post(`${ADMIN_PATH}/${inquiry.id}/status`)
      .set("Cookie", adminCookie)
      .send({ status: "IN_PROGRESS", internalNote: "この人は先月も同じ相談をしている" })
      .expect(201);

    const mine = await request(app.getHttpServer()).get(MINE_PATH).set("Cookie", user.cookie).expect(200);
    expect(JSON.stringify(mine.body)).not.toContain("先月も同じ相談");
    expect(mine.body[0].status).toBe("IN_PROGRESS");
  });

  it("退会済みの相手には返信できない (読まれないため)", async () => {
    const user = await loginUser();
    const created = await request(app.getHttpServer())
      .post(MINE_PATH)
      .set("Cookie", user.cookie)
      .send({ category: "LOGIN_OR_ACCOUNT", message: "退会します" })
      .expect(201);
    const inquiry = await prisma.supportInquiry.findFirstOrThrow({
      where: { inquiryCode: created.body.inquiry_code },
    });

    await request(app.getHttpServer())
      .post("/api/v1/accounts/me/close")
      .set("Cookie", user.cookie)
      .expect(201);

    await request(app.getHttpServer())
      .post(`${ADMIN_PATH}/${inquiry.id}/reply`)
      .set("Cookie", adminCookie)
      .send({ title: "ご連絡", message: "承知しました。" })
      .expect(400);
  });

  it("AUDITORは読めるが、返信も状態変更もできない", async () => {
    const user = await loginUser();
    const created = await request(app.getHttpServer())
      .post(MINE_PATH)
      .set("Cookie", user.cookie)
      .send({ category: "OTHER", message: "権限の確認" })
      .expect(201);
    const inquiry = await prisma.supportInquiry.findFirstOrThrow({
      where: { inquiryCode: created.body.inquiry_code },
    });

    await request(app.getHttpServer()).get(ADMIN_PATH).set("Cookie", auditorCookie).expect(200);
    await request(app.getHttpServer())
      .post(`${ADMIN_PATH}/${inquiry.id}/status`)
      .set("Cookie", auditorCookie)
      .send({ status: "CLOSED" })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${ADMIN_PATH}/${inquiry.id}/reply`)
      .set("Cookie", auditorCookie)
      .send({ title: "x", message: "y" })
      .expect(403);
  });

  it("未ログインの管理APIは401", async () => {
    await request(app.getHttpServer()).get(ADMIN_PATH).expect(401);
  });
});
