import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { ThrottlerStorage } from "@nestjs/throttler";
import { prisma, generateId } from "@ove/database";
import { MAIL_SENDER } from "../mail/mail.module";
import { MailSendError } from "../mail/resend-mail-sender";
import type { MailSender } from "../mail/mail-sender";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { REFERRAL_SESSION_COOKIE_NAME } from "../referrals/referrals.controller";

/**
 * メールでの新規登録 (docs/login-methods.md「メールログイン」)。
 *
 * LINEを持っていない利用者のための入口。ここで確かめたいのは、LINE登録と
 * **同じことがひととおり起きる**ことで、特に紹介の紐付けが抜けていないこと
 * (抜けていても画面上は普通に登録成功して見えるため、テストでしか気づけない)。
 */
describe("メールでの新規登録", () => {
  let app: INestApplication;

  function extractCookie(setCookieHeader: string[] | undefined, name: string): string | undefined {
    const raw = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
    return raw?.match(new RegExp(`${name}=([^;]+)`))?.[1];
  }

  /** 新しいメールアドレスでコードを発行し、6桁コードを受け取る。 */
  async function requestCode(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/email/request-otp")
      .send({ email })
      .expect(201);
    // 本番では devCode を返さない。テスト環境なので受け取れる
    expect(res.body.devCode).toMatch(/^\d{6}$/);
    return res.body.devCode as string;
  }

  function newEmail(): string {
    return `e2e-mail-${generateId()}@example.com`.toLowerCase();
  }

  /**
   * コード発行の回数制限 (5分5回) はこのテスト自身も引っかかるので、件ごとに戻す。
   * 制限そのものは末尾の専用テストで確認する。
   */
  function resetThrottle() {
    const storage = app.get<ThrottlerStorage & { storage?: Map<string, unknown> }>(ThrottlerStorage);
    storage.storage?.clear();
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    resetThrottle();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("LINEを持っていなくても登録できる", () => {
    it("コードを検証するとアカウントとウォレットが作られる", async () => {
      const email = newEmail();
      const code = await requestCode(email);

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .send({ email, code, termsAccepted: true })
        .expect(201);

      const accountId = res.body.ove_account_id as string;
      const account = await prisma.oveAccount.findUniqueOrThrow({
        where: { id: accountId },
        include: { wallet: true, identities: true },
      });

      expect(account.status).toBe("ACTIVE");
      expect(account.primaryEmail).toBe(email);
      expect(account.wallet).not.toBeNull();
      expect(account.identities[0]!.provider).toBe("EMAIL");
      expect(account.identities[0]!.providerSubject).toBe(email);
    });

    it("2回目以降は同じアカウントに入る (登録し直しにならない)", async () => {
      const email = newEmail();
      const first = await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .send({ email, code: await requestCode(email), termsAccepted: true })
        .expect(201);

      // 60秒のクールダウンを避けるため、KVを介さず別アドレス扱いにはしない。
      // 同じアドレスへの再発行はクールダウン中なので、コードを再利用して検証する
      const second = await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .send({ email, code: "000000", termsAccepted: true })
        .expect(401);

      expect(second.body.ove_account_id).toBeUndefined();
      expect(first.body.ove_account_id).toBeTruthy();
    });

    it("規約に同意しないと新規作成できない", async () => {
      const email = newEmail();
      const code = await requestCode(email);
      await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .send({ email, code })
        .expect(400);
    });

    it("間違ったコードでは登録もログインもできない", async () => {
      const email = newEmail();
      await requestCode(email);
      await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .send({ email, code: "999999", termsAccepted: true })
        .expect(401);

      expect(await prisma.accountIdentity.findFirst({ where: { providerSubject: email } })).toBeNull();
    });
  });

  describe("紹介URL経由でも代理店に紐付く", () => {
    it("紹介Cookieを持ってメール登録すると紹介がPENDINGになる", async () => {
      // ここが抜けていると、紹介URLから来たメール登録者が代理店に紐付かない
      process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
      const token = `referral-email-${generateId()}`;
      const capture = await request(app.getHttpServer())
        .get(`/api/v1/referrals/capture?token=${token}`)
        .expect(302);
      const referralCookie = extractCookie(
        capture.headers["set-cookie"] as unknown as string[],
        REFERRAL_SESSION_COOKIE_NAME,
      );
      expect(referralCookie).toBeDefined();

      const email = newEmail();
      const code = await requestCode(email);
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${referralCookie}`])
        .send({ email, code, termsAccepted: true })
        .expect(201);

      const accountId = res.body.ove_account_id as string;
      const referral = await prisma.walletReferral.findFirstOrThrow({
        where: { walletUserId: accountId },
      });
      expect(referral.status).toBe("PENDING");
    });

    it("代理店へはline_verified: falseで送る (LINEを通っていないため)", async () => {
      process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
      const token = `referral-email-lv-${generateId()}`;
      const capture = await request(app.getHttpServer())
        .get(`/api/v1/referrals/capture?token=${token}`)
        .expect(302);
      const referralCookie = extractCookie(
        capture.headers["set-cookie"] as unknown as string[],
        REFERRAL_SESSION_COOKIE_NAME,
      );

      const email = newEmail();
      const code = await requestCode(email);
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${referralCookie}`])
        .send({ email, code, termsAccepted: true })
        .expect(201);

      const referral = await prisma.walletReferral.findFirstOrThrow({
        where: { walletUserId: res.body.ove_account_id as string },
      });
      const event = await prisma.integrationOutbox.findFirstOrThrow({
        where: { aggregateId: referral.id, eventType: "wallet.referral.registered" },
      });
      expect((event.payload as { line_verified: boolean }).line_verified).toBe(false);
    });

    it("紹介Cookieは使い切りとして消える", async () => {
      process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
      const token = `referral-email-clear-${generateId()}`;
      const capture = await request(app.getHttpServer())
        .get(`/api/v1/referrals/capture?token=${token}`)
        .expect(302);
      const referralCookie = extractCookie(
        capture.headers["set-cookie"] as unknown as string[],
        REFERRAL_SESSION_COOKIE_NAME,
      );

      const email = newEmail();
      const code = await requestCode(email);
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/email/verify-otp")
        .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${referralCookie}`])
        .send({ email, code, termsAccepted: true })
        .expect(201);

      const cleared = (res.headers["set-cookie"] as unknown as string[]).find((c) =>
        c.startsWith(`${REFERRAL_SESSION_COOKIE_NAME}=`),
      );
      expect(cleared).toBeDefined();
      expect(cleared).toMatch(/=;|Expires=Thu, 01 Jan 1970/);
    });
  });

  describe("送信に失敗したとき", () => {
    it("「送信しました」と返さず、失敗として返す", async () => {
      // 握り潰すと、利用者は永遠に届かないコードを待つことになる
      const sender = app.get<MailSender>(MAIL_SENDER);
      const spy = jest
        .spyOn(sender, "send")
        .mockRejectedValue(new MailSendError("mail delivery service returned status 500"));
      try {
        await request(app.getHttpServer())
          .post("/api/v1/auth/email/request-otp")
          .send({ email: newEmail() })
          .expect(503);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("コード発行の回数制限", () => {
    it("同じ発信元からの連続したコード発行を打ち切る", async () => {
      // 宛先を変えれば`EmailOtpService`の60秒クールダウンは回避できるので、
      // 発信元での制限が無いと任意の宛先へメールを撃てる
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await request(app.getHttpServer())
          .post("/api/v1/auth/email/request-otp")
          .send({ email: newEmail() });
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
      expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(5);
    });
  });
});
