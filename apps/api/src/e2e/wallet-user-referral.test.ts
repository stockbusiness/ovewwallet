import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { REFERRAL_SESSION_COOKIE_NAME } from "../referrals/referrals.controller";
import { WALLET_USER_REFERRAL_COOKIE_NAME } from "../wallet-user-referrals/wallet-user-referrals.controller";

/**
 * ウォレット利用者同士の紹介 (`docs/wallet-user-referral.md`)。
 *
 * ここで固定したいのは「代理店紹介を上書きしない」こと。代理店紹介リンクと
 * ウォレット紹介リンクを続けて開いた人は両方のCookieを持ちうるため、どちらが
 * 残るかをテストで決めておく。
 */
describe("ウォレット利用者同士の紹介", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  /** 紹介者を1人作り、紹介コードを発行して返す。 */
  async function createReferrerWithCode(): Promise<{ accountId: string; code: string }> {
    const accountId = generateId();
    const code = `wur${generateId()}`.slice(0, 32);
    await prisma.oveAccount.create({
      data: {
        id: accountId,
        accountCode: `OVE-ACC-WUR-${generateId()}`,
        status: "ACTIVE",
        walletReferralCode: code,
      },
    });
    return { accountId, code };
  }

  /** `/r/{code}` 相当。紹介セッションCookieの生トークンを返す。 */
  async function capture(code: string): Promise<string | undefined> {
    const res = await request(server)
      .get(`/api/v1/wallet-user-referrals/capture?code=${encodeURIComponent(code)}`)
      .expect(302);
    const cookies = (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    const cookie = cookies.find((c) => c.startsWith(`${WALLET_USER_REFERRAL_COOKIE_NAME}=`));
    return cookie?.split(";")[0]?.split("=")[1];
  }

  /** 紹介セッションCookieを付けてLINE新規登録する。 */
  async function registerWithCookies(cookies: string[]): Promise<string> {
    const res = await request(server)
      .post("/api/v1/auth/line/login")
      .set("Cookie", cookies)
      .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
      .expect(201);
    return res.body.ove_account_id as string;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    server = app.getHttpServer();
  });

  beforeEach(() => {
    process.env.ENABLE_WALLET_USER_REFERRAL = "true";
  });

  afterEach(() => {
    delete process.env.ENABLE_WALLET_USER_REFERRAL;
    delete process.env.ENABLE_WALLET_REFERRAL_TOKEN;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("紹介URLから新規登録すると紹介関係がREGISTEREDで成立する", async () => {
    const referrer = await createReferrerWithCode();
    const token = await capture(referrer.code);
    expect(token).toBeDefined();

    const referredId = await registerWithCookies([`${WALLET_USER_REFERRAL_COOKIE_NAME}=${token}`]);

    const referral = await prisma.walletUserReferral.findUniqueOrThrow({
      where: { referredAccountId: referredId },
    });
    expect(referral.referrerAccountId).toBe(referrer.accountId);
    expect(referral.status).toBe("REGISTERED");
    expect(referral.registeredAt).not.toBeNull();
    expect(referral.usedAt).not.toBeNull();
  });

  it("同じ紹介セッションは2人目には使えない (使い切り)", async () => {
    const referrer = await createReferrerWithCode();
    const token = await capture(referrer.code);

    await registerWithCookies([`${WALLET_USER_REFERRAL_COOKIE_NAME}=${token}`]);
    const secondId = await registerWithCookies([`${WALLET_USER_REFERRAL_COOKIE_NAME}=${token}`]);

    const second = await prisma.walletUserReferral.findUnique({
      where: { referredAccountId: secondId },
    });
    expect(second).toBeNull();
  });

  it("代理店紹介が同時に来た場合は代理店を優先し、ウォレット紹介はEXCLUDEDで閉じる", async () => {
    process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
    const referrer = await createReferrerWithCode();
    const walletToken = await capture(referrer.code);

    // 代理店紹介セッションも作る (`/api/v1/referrals/capture`)。
    const agencyRes = await request(server)
      .get(`/api/v1/referrals/capture?token=agency-${generateId()}`)
      .expect(302);
    const agencyCookies = (agencyRes.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    const agencyToken = agencyCookies
      .find((c) => c.startsWith(`${REFERRAL_SESSION_COOKIE_NAME}=`))
      ?.split(";")[0]
      ?.split("=")[1];
    expect(agencyToken).toBeDefined();

    const referredId = await registerWithCookies([
      `${WALLET_USER_REFERRAL_COOKIE_NAME}=${walletToken}`,
      `${REFERRAL_SESSION_COOKIE_NAME}=${agencyToken}`,
    ]);

    // 代理店紹介だけが成立している。
    const agencyReferral = await prisma.walletReferral.findUnique({
      where: { walletUserId: referredId },
    });
    expect(agencyReferral?.status).toBe("PENDING");

    // ウォレット紹介は成立させず、再利用もできないよう閉じている。
    const walletReferral = await prisma.walletUserReferral.findFirstOrThrow({
      where: { referrerAccountId: referrer.accountId },
    });
    expect(walletReferral.status).toBe("EXCLUDED");
    expect(walletReferral.referredAccountId).toBeNull();
    expect(walletReferral.reason).toBe("agency_referral_takes_precedence");
    expect(walletReferral.usedAt).not.toBeNull();
  });

  it("Feature Flag OFFでは紹介セッションを作らず、登録は通常どおり成功する", async () => {
    delete process.env.ENABLE_WALLET_USER_REFERRAL;
    const referrer = await createReferrerWithCode();

    const token = await capture(referrer.code);
    expect(token).toBeUndefined();

    // Cookieが無いだけで、登録そのものは止めない。
    const referredId = await registerWithCookies([]);
    expect(referredId).toBeDefined();

    const count = await prisma.walletUserReferral.count({
      where: { referrerAccountId: referrer.accountId },
    });
    expect(count).toBe(0);
  });

  it("存在しない紹介コード・退会済みの紹介者ではセッションを作らない", async () => {
    expect(await capture(`missing${generateId()}`.slice(0, 32))).toBeUndefined();

    const closed = await createReferrerWithCode();
    await prisma.oveAccount.update({ where: { id: closed.accountId }, data: { status: "CLOSED" } });
    expect(await capture(closed.code)).toBeUndefined();
  });

  it("期限切れの紹介セッションは紐付かずEXPIREDになる", async () => {
    const referrer = await createReferrerWithCode();
    const token = await capture(referrer.code);
    const referral = await prisma.walletUserReferral.findFirstOrThrow({
      where: { referrerAccountId: referrer.accountId },
    });
    await prisma.walletUserReferral.update({
      where: { id: referral.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const referredId = await registerWithCookies([`${WALLET_USER_REFERRAL_COOKIE_NAME}=${token}`]);

    expect(
      await prisma.walletUserReferral.findUnique({ where: { referredAccountId: referredId } }),
    ).toBeNull();
    const after = await prisma.walletUserReferral.findUniqueOrThrow({ where: { id: referral.id } });
    expect(after.status).toBe("EXPIRED");
  });
});
