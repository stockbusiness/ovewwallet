import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { decryptSecret, sha256Hex } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { REFERRAL_SESSION_COOKIE_NAME } from "../referrals/referrals.controller";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";

/**
 * 代理店システムが登録URLへ直接載せてくる紹介パラメータの受け入れ
 * (`docs/integration/AGENCY_POINT_AWARD.md` 1章)。
 *
 * ここで確認したいのは「ENABLE_AGENCY_REFERRAL_SYNC が無効でも、URLで渡された
 * referral_session_key / agency_id を取りこぼさない」こと。代理店システムへの
 * 問い合わせ (`POST /api/referrals/capture`) は本番のsengoku-ai.comを叩くことに
 * なるため、このテストではFlagを無効のままにして呼び出しが起きない状態で検証する。
 */
describe("紹介URLのクエリパラメータ受け入れ", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
    process.env.ENABLE_AGENCY_REFERRAL_SYNC = "false";
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function extractCookie(setCookieHeader: string[] | undefined): string | undefined {
    const raw = setCookieHeader?.find((c) => c.startsWith(`${REFERRAL_SESSION_COOKIE_NAME}=`));
    return raw?.match(new RegExp(`${REFERRAL_SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
  }

  async function capture(query: string) {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referrals/capture?${query}`)
      .expect(302);
    const cookieValue = extractCookie(res.headers["set-cookie"] as unknown as string[]);
    const referral = cookieValue
      ? await prisma.walletReferral.findUnique({
          where: { sessionTokenHash: sha256Hex(cookieValue) },
        })
      : null;
    return { location: res.headers.location as string | undefined, cookieValue, referral };
  }

  it("accepts referral_token / referral_session_key / agency_id / source", async () => {
    const token = `rt_${generateId()}`;
    const sessionKey = `rs_${generateId()}`;
    const agencyId = `agency-${generateId()}`;

    const { location, cookieValue, referral } = await capture(
      `referral_token=${token}&referral_session_key=${sessionKey}&agency_id=${agencyId}&source=sengoku-agency`,
    );

    expect(cookieValue).toBeDefined();
    expect(location).toContain("/login");
    expect(referral).not.toBeNull();
    expect(referral!.referralSessionKey).toBe(sessionKey);
    expect(referral!.agencyId).toBe(agencyId);
    expect(referral!.source).toBe("sengoku-agency");
    expect(referral!.status).toBe("CAPTURED");
    // URLで渡されたトークンは、そのままconfirm送信で返せるようcanonical側にも入る。
    expect(decryptSecret(referral!.canonicalReferralTokenEncrypted!, ENCRYPTION_KEY)).toBe(token);
  });

  it("accepts the short aliases rt / rs", async () => {
    const token = `rt_${generateId()}`;
    const sessionKey = `rs_${generateId()}`;

    const { referral } = await capture(`rt=${token}&rs=${sessionKey}`);

    expect(referral).not.toBeNull();
    expect(referral!.referralSessionKey).toBe(sessionKey);
    expect(referral!.referralTokenHash).toBe(sha256Hex(token));
  });

  it("still accepts the original token parameter", async () => {
    const token = `legacy-${generateId()}`;
    const { referral } = await capture(`token=${token}`);

    expect(referral).not.toBeNull();
    expect(referral!.referralTokenHash).toBe(sha256Hex(token));
    expect(referral!.source).toBe("invite_url");
    // referral_session_keyが無い場合は、代理店システムへの問い合わせ待ちのまま。
    expect(referral!.referralSessionKey).toBeNull();
  });

  it("drops accompanying params that do not look like identifiers", async () => {
    const token = `rt_${generateId()}`;
    const { referral } = await capture(
      `rt=${token}&rs=${encodeURIComponent("<script>alert(1)</script>")}` +
        `&agency_id=${encodeURIComponent("../../etc/passwd")}&source=${encodeURIComponent("a b c")}`,
    );

    expect(referral).not.toBeNull();
    expect(referral!.referralSessionKey).toBeNull();
    expect(referral!.agencyId).toBeNull();
    expect(referral!.source).toBe("invite_url");
  });

  it("does not leak the token through the Referer header", async () => {
    const token = `rt_${generateId()}`;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referrals/capture?rt=${token}`)
      .expect(302);

    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
    // リダイレクト先にトークンを載せない (オープンリダイレクト・漏えい対策)。
    expect(res.headers.location).not.toContain(token);
  });
});
