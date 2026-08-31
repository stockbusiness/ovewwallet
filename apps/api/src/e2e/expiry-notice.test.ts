import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { ExpiryNoticeService } from "../scheduler/expiry-notice.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 失効予告の自動生成と、個別通知 (`Notice.oveAccountId`) の宛先分離。
 *
 * 導入前は、失効間近のORIに気づく手段がアプリを開いたときのバナーだけで、
 * 失効バッチが黙って残高を減らす形になっていた。
 */
describe("失効予告の自動生成 (ExpiryNoticeService)", () => {
  let app: INestApplication;
  let service: ExpiryNoticeService;

  async function createUser() {
    const idToken = `mock.${generateId()}`;
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    const cookie = login.headers["set-cookie"] as unknown as string[];
    const oveAccountId = login.body.ove_account_id as string;
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    return { cookie, oveAccountId, walletId: wallet.id };
  }

  async function grant(walletId: string, amount: number, expiresAt: Date) {
    await creditWallet({
      walletId,
      amount,
      transactionType: "CAMPAIGN_REWARD",
      idempotencyKey: generateId(),
      displayName: "expiry notice e2e",
      createdByType: "ADMIN",
      expiresAt,
    });
  }

  async function noticesFor(oveAccountId: string) {
    return prisma.notice.findMany({ where: { oveAccountId }, orderBy: { publishedAt: "desc" } });
  }

  /** 通知が1件だけ作られていることを確かめた上で、その1件を返す。 */
  async function onlyNoticeFor(oveAccountId: string) {
    const notices = await noticesFor(oveAccountId);
    expect(notices).toHaveLength(1);
    const notice = notices[0];
    if (!notice) throw new Error("unreachable");
    return notice;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    service = app.get(ExpiryNoticeService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("予告日数以内に失効するロットについて本人宛のお知らせを作る", async () => {
    const user = await createUser();
    await grant(user.walletId, 1500, new Date(Date.now() + 3 * DAY_MS));

    await service.createExpiryNotices();

    const notice = await onlyNoticeFor(user.oveAccountId);
    expect(notice.importance).toBe("IMPORTANT");
    expect(notice.message).toContain("1,500 ORI");
  });

  it("同じアカウントの複数ロットは1通にまとめ、合計額と最短の失効日を載せる", async () => {
    const user = await createUser();
    const soon = new Date(Date.now() + 2 * DAY_MS);
    await grant(user.walletId, 1000, soon);
    await grant(user.walletId, 2000, new Date(Date.now() + 5 * DAY_MS));

    await service.createExpiryNotices();

    const notice = await onlyNoticeFor(user.oveAccountId);
    expect(notice.message).toContain("3,000 ORI");
    // 最短の失効日 (JSTの暦日) が載っていること
    const jstDate = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(soon);
    expect(notice.message).toContain(jstDate);
  });

  it("2回実行しても同じロットで重複して通知しない", async () => {
    const user = await createUser();
    await grant(user.walletId, 800, new Date(Date.now() + 4 * DAY_MS));

    await service.createExpiryNotices();
    await service.createExpiryNotices();

    expect(await noticesFor(user.oveAccountId)).toHaveLength(1);
  });

  it("予告日数より先に失効するロット・既に失効日を過ぎたロットは対象外", async () => {
    const user = await createUser();
    await grant(user.walletId, 500, new Date(Date.now() + 60 * DAY_MS));
    await grant(user.walletId, 700, new Date(Date.now() - DAY_MS));

    await service.createExpiryNotices();

    expect(await noticesFor(user.oveAccountId)).toHaveLength(0);

    // 期限切れのまま残すと、同じテストDBを共有する失効バッチのテスト
    // (`packages/ledger/src/expiry.test.ts`) が「失効対象は自分が作った1件だけ」を
    // 前提にしているため落ちる。検証は済んでいるので失効バッチの対象から外しておく。
    await prisma.oveCreditLot.updateMany({
      where: { walletId: user.walletId, expiresAt: { lt: new Date() } },
      data: { voidedAt: new Date() },
    });
  });

  it("退会済みアカウントには通知しない", async () => {
    const user = await createUser();
    await grant(user.walletId, 900, new Date(Date.now() + 3 * DAY_MS));
    await prisma.oveAccount.update({ where: { id: user.oveAccountId }, data: { status: "CLOSED" } });

    await service.createExpiryNotices();

    expect(await noticesFor(user.oveAccountId)).toHaveLength(0);
  });

  it("個別通知は宛先本人にだけ見え、他人の一覧には出ない", async () => {
    const owner = await createUser();
    const other = await createUser();
    await grant(owner.walletId, 1200, new Date(Date.now() + 3 * DAY_MS));

    await service.createExpiryNotices();
    const notice = await onlyNoticeFor(owner.oveAccountId);

    const ownerList = await request(app.getHttpServer())
      .get("/api/v1/me/notices")
      .set("Cookie", owner.cookie)
      .expect(200);
    expect(ownerList.body.map((n: { id: string }) => n.id)).toContain(notice.id);

    const otherList = await request(app.getHttpServer())
      .get("/api/v1/me/notices")
      .set("Cookie", other.cookie)
      .expect(200);
    expect(otherList.body.map((n: { id: string }) => n.id)).not.toContain(notice.id);
  });

  it("他人宛の個別通知は既読にできない (存在を知られないよう404)", async () => {
    const owner = await createUser();
    const other = await createUser();
    await grant(owner.walletId, 1300, new Date(Date.now() + 3 * DAY_MS));

    await service.createExpiryNotices();
    const notice = await onlyNoticeFor(owner.oveAccountId);

    await request(app.getHttpServer())
      .post(`/api/v1/me/notices/${notice.id}/read`)
      .set("Cookie", other.cookie)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/me/notices/${notice.id}/read`)
      .set("Cookie", owner.cookie)
      .expect(201);
  });

  it("全員向けのお知らせは従来どおり全員に見える", async () => {
    const adminEmail = `expiry-notice-admin-${generateId()}@ovewallet.local`;
    const password = "expiry-notice-e2e-password";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-EXPNT-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "Expiry Notice E2E Admin",
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password })
      .expect(201);
    const adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];

    const created = await request(app.getHttpServer())
      .post("/api/v1/admin/notices")
      .set("Cookie", adminCookie)
      .send({ title: "全員向け", message: "全員に見えるお知らせ" })
      .expect(201);

    const user = await createUser();
    const list = await request(app.getHttpServer())
      .get("/api/v1/me/notices")
      .set("Cookie", user.cookie)
      .expect(200);
    expect(list.body.map((n: { id: string }) => n.id)).toContain(created.body.id);

    // 管理画面の一覧には個別通知を混ぜない (管理者が作ったお知らせが埋もれるため)
    const owner = await createUser();
    await grant(owner.walletId, 1100, new Date(Date.now() + 3 * DAY_MS));
    await service.createExpiryNotices();
    const targeted = await onlyNoticeFor(owner.oveAccountId);

    const adminList = await request(app.getHttpServer())
      .get("/api/v1/admin/notices")
      .set("Cookie", adminCookie)
      .expect(200);
    const adminIds = adminList.body.map((n: { id: string }) => n.id);
    expect(adminIds).toContain(created.body.id);
    expect(adminIds).not.toContain(targeted.id);
  });
});
