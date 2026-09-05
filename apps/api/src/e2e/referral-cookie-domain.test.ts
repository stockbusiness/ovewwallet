import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { REFERRAL_SESSION_COOKIE_NAME } from "../referrals/referrals.controller";

/**
 * 紹介Cookieが実際にどのドメイン向けで発行されるか (`referral-cookie.ts`)。
 *
 * 本番で `Set-Cookie` に `Domain=` が無く、Cookieが `api.sennokuni-wallet.com`
 * 専用になっていたためログイン時に送られていなかった (2026-09-05、DevToolsで確認)。
 * ユニットテストは判定ロジックしか見ないので、**実際に出るヘッダー**をここで押さえる。
 *
 * E2E (Playwright) はローカルの `localhost:3000` / `localhost:4000` で動き、
 * Cookieはポートを区別しないため同一ホスト扱いになる。この不具合を検出できなかった
 * のはそのため。ここではHostヘッダーを差し替えて本番と同じホスト構成を再現する。
 */
describe("紹介Cookieのドメイン", () => {
  let app: INestApplication;
  const originalAppUrl = process.env.APP_URL;

  /** Hostヘッダーを差し替えてcaptureを叩き、Set-Cookieの行を返す。 */
  async function captureWithHost(host: string): Promise<string | undefined> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/referrals/capture?token=referral-cookie-${generateId()}`)
      .set("Host", host)
      .expect(302);
    const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
    return setCookie?.find((c) => c.startsWith(`${REFERRAL_SESSION_COOKIE_NAME}=`));
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
  });

  afterAll(async () => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    await app.close();
    await prisma.$disconnect();
  });

  it("APIがウォレットのサブドメインなら、Domainを付けて共有できるようにする", async () => {
    process.env.APP_URL = "https://sennokuni-wallet.com";
    const cookie = await captureWithHost("api.sennokuni-wallet.com");

    expect(cookie).toBeDefined();
    expect(cookie).toContain("Domain=sennokuni-wallet.com");
    // 発行元ホスト専用だと、ウォレットドメイン宛のログインへ送られない
    expect(cookie).not.toContain("Domain=api.sennokuni-wallet.com");
  });

  it("従来どおりHttpOnly・Secure・SameSite=Noneで発行する", async () => {
    process.env.APP_URL = "https://sennokuni-wallet.com";
    const cookie = await captureWithHost("api.sennokuni-wallet.com");

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Path=/");
  });

  it("APIが別ドメインで受けているならDomainを付けない (ブラウザに拒否させない)", async () => {
    process.env.APP_URL = "https://sennokuni-wallet.com";
    const cookie = await captureWithHost("ove-api.up.railway.app");

    expect(cookie).toBeDefined();
    expect(cookie).not.toContain("Domain=");
  });

  it("ローカル開発ではDomainを付けない", async () => {
    process.env.APP_URL = "http://localhost:3000";
    const cookie = await captureWithHost("localhost");

    expect(cookie).toBeDefined();
    expect(cookie).not.toContain("Domain=");
  });
});
