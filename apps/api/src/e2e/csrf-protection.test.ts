import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER, WALLET_CODE_COUNTER } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const ALLOWED_ADMIN_ORIGIN = "https://admin.example.com";

/**
 * CSRF対策 (`csrf-protection.middleware.ts`) の回帰テスト。
 *
 * 修正前は、攻撃者サイトに置いた自動送信フォームから
 * `POST /api/v1/admin/holds/:holdId/release` が実際に成立し、保留が解除できてしまった
 * (`sameSite: "none"` によりブラウザがクロスサイトPOSTにも管理者セッションCookieを
 * 添付し、form-urlencodedは単純リクエストなのでプリフライトなしでハンドラへ到達する)。
 */
describe("CSRF対策", () => {
  let app: INestApplication;
  let cookie: string[];
  const password = "csrf-e2e-password-123";
  const originalAppUrl = process.env.APP_URL;
  const originalAdminUrl = process.env.ADMIN_URL;

  async function createHold(): Promise<string> {
    const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const account = await prisma.oveAccount.create({
      data: { id: generateId(), accountCode, status: "ACTIVE", displayName: "CSRF E2E User" },
    });
    const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
    const wallet = await prisma.wallet.create({
      data: {
        id: generateId(),
        oveAccountId: account.id,
        walletCode,
        status: "ACTIVE",
        availableBalance: 1000n,
        lifetimeCredited: 1000n,
      },
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/admin/wallets/hold")
      .set("Cookie", cookie)
      .set("Origin", ALLOWED_ADMIN_ORIGIN)
      .send({ walletId: wallet.id, amount: 400, reason: "CSRF回帰テスト" })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    // 許可オリジン一覧はミドルウェアが実行時に参照するため、app生成前に設定する。
    process.env.ADMIN_URL = ALLOWED_ADMIN_ORIGIN;

    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const email = `csrf-e2e-${generateId()}@ovewallet.local`;
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "CSRF E2E Admin",
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .set("Origin", ALLOWED_ADMIN_ORIGIN)
      .send({ email, password })
      .expect(201);
    cookie = login.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    process.env.APP_URL = originalAppUrl;
    process.env.ADMIN_URL = originalAdminUrl;
  });

  it("rejects a cross-site form POST that would otherwise release a hold", async () => {
    const holdId = await createHold();

    await request(app.getHttpServer())
      .post(`/api/v1/admin/holds/${holdId}/release`)
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example.com")
      .type("form")
      .send("")
      .expect(403);

    // 副作用が発生していないこと (403を返すだけでなく保留が維持されていること) を確認する。
    const hold = await prisma.walletHold.findUniqueOrThrow({ where: { id: holdId } });
    expect(hold.status).toBe("HELD");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: hold.walletId } });
    expect(wallet.availableBalance).toBe(600n);
    expect(wallet.heldBalance).toBe(400n);
  });

  it("rejects a JSON POST from a disallowed origin", async () => {
    const holdId = await createHold();

    await request(app.getHttpServer())
      .post(`/api/v1/admin/holds/${holdId}/release`)
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example.com")
      .send({})
      .expect(403);

    const hold = await prisma.walletHold.findUniqueOrThrow({ where: { id: holdId } });
    expect(hold.status).toBe("HELD");
  });

  it("rejects a form-encoded POST even when the origin is allowed", async () => {
    const holdId = await createHold();

    // 単純リクエストのContent-Type自体を塞ぐ多層防御。オリジン検証とは独立に効く。
    await request(app.getHttpServer())
      .post(`/api/v1/admin/holds/${holdId}/release`)
      .set("Cookie", cookie)
      .set("Origin", ALLOWED_ADMIN_ORIGIN)
      .type("form")
      .send("")
      .expect(403);

    const hold = await prisma.walletHold.findUniqueOrThrow({ where: { id: holdId } });
    expect(hold.status).toBe("HELD");
  });

  it("still allows a legitimate JSON POST from an allowed origin", async () => {
    const holdId = await createHold();

    await request(app.getHttpServer())
      .post(`/api/v1/admin/holds/${holdId}/release`)
      .set("Cookie", cookie)
      .set("Origin", ALLOWED_ADMIN_ORIGIN)
      .send({})
      .expect(201);

    const hold = await prisma.walletHold.findUniqueOrThrow({ where: { id: holdId } });
    expect(hold.status).toBe("RELEASED");
  });

  it("still allows a server-to-server POST that carries no Origin header", async () => {
    // HMAC認証の外部API・共通イベント受信口はブラウザ経由ではないため`Origin`が付かない。
    // これらを巻き込まないことを保証する (認証はHMAC署名で別途行われる)。
    const holdId = await createHold();

    await request(app.getHttpServer())
      .post(`/api/v1/admin/holds/${holdId}/release`)
      .set("Cookie", cookie)
      .send({})
      .expect(201);

    const hold = await prisma.walletHold.findUniqueOrThrow({ where: { id: holdId } });
    expect(hold.status).toBe("RELEASED");
  });

  it("does not block safe methods from any origin", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/admin/wallets")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example.com")
      .expect(200);
  });
});
