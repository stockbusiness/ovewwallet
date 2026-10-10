import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { hashSecret } from "@ove/auth";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

interface Row {
  id: string;
  account_code: string | null;
  display_name: string | null;
  status: string;
  reason: string | null;
}

interface View {
  referred_by: Row | null;
  referrals_made: Row[];
  established_count: number;
}

/**
 * 管理画面のウォレット紹介の可視化 (`docs/wallet-user-referral.md`)。
 *
 * 「紹介したはずなのに数に入らない」という問い合わせに答える画面なので、
 * **成立しなかった関係とその理由も返る**ことを固定する。
 */
describe("管理画面のウォレット紹介の可視化", () => {
  let app: INestApplication;
  let cookie: string[];

  async function createAccount(displayName?: string): Promise<string> {
    const id = generateId();
    await prisma.oveAccount.create({
      data: {
        id,
        accountCode: await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC"),
        status: "ACTIVE",
        displayName,
      },
    });
    return id;
  }

  async function createReferral(params: {
    referrerAccountId: string;
    referredAccountId?: string;
    status: "CAPTURED" | "REGISTERED" | "INHERITED" | "EXCLUDED" | "EXPIRED";
    reason?: string;
  }): Promise<string> {
    const id = generateId();
    await prisma.walletUserReferral.create({
      data: {
        id,
        referrerAccountId: params.referrerAccountId,
        referredAccountId: params.referredAccountId,
        sessionTokenHash: `hash-${id}`,
        status: params.status,
        expiresAt: new Date(Date.now() + 86_400_000),
        registeredAt: params.referredAccountId ? new Date() : null,
        reason: params.reason,
      },
    });
    return id;
  }

  async function fetchView(accountId: string, expected = 200): Promise<View> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/accounts/${accountId}/wallet-user-referrals`)
      .set("Cookie", cookie)
      .expect(expected);
    return res.body as View;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const email = `wur-admin-${generateId()}@ovewallet.local`;
    const password = "wallet-user-referral-admin-e2e-password";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-WURA-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "Wallet User Referral Admin E2E",
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    cookie = login.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("紹介した相手と紹介元の両方を返す", async () => {
    const referrer = await createAccount("紹介した人");
    const referredA = await createAccount("紹介された人A");
    const referredB = await createAccount("紹介された人B");
    await createReferral({ referrerAccountId: referrer, referredAccountId: referredA, status: "REGISTERED" });
    await createReferral({ referrerAccountId: referrer, referredAccountId: referredB, status: "INHERITED" });

    const view = await fetchView(referrer);
    expect(view.established_count).toBe(2);
    expect(view.referrals_made.map((r) => r.display_name).sort()).toEqual([
      "紹介された人A",
      "紹介された人B",
    ]);
    expect(view.referred_by).toBeNull();

    // 紹介された側から見ると、紹介元が1件返る。
    const fromReferred = await fetchView(referredA);
    expect(fromReferred.referred_by?.display_name).toBe("紹介した人");
    expect(fromReferred.referrals_made).toHaveLength(0);
  });

  it("成立しなかった関係も理由付きで返し、成立件数には数えない", async () => {
    const referrer = await createAccount();
    const excluded = await createAccount("対象外になった人");
    await createReferral({
      referrerAccountId: referrer,
      referredAccountId: excluded,
      status: "EXCLUDED",
      reason: "agency_referral_takes_precedence",
    });
    await createReferral({ referrerAccountId: referrer, status: "EXPIRED" });

    const view = await fetchView(referrer);
    expect(view.established_count).toBe(0);
    expect(view.referrals_made).toHaveLength(2);

    const excludedRow = view.referrals_made.find((r) => r.status === "EXCLUDED");
    expect(excludedRow?.reason).toBe("agency_referral_takes_precedence");
    expect(excludedRow?.display_name).toBe("対象外になった人");

    // 登録前に期限切れになった行は相手が居ないため null で返る。
    const expiredRow = view.referrals_made.find((r) => r.status === "EXPIRED");
    expect(expiredRow?.account_code).toBeNull();
  });

  it("登録前のセッション (CAPTURED) は人として数えないため返さない", async () => {
    const referrer = await createAccount();
    await createReferral({ referrerAccountId: referrer, status: "CAPTURED" });

    const view = await fetchView(referrer);
    expect(view.referrals_made).toHaveLength(0);
    expect(view.established_count).toBe(0);
  });

  it("紹介がまったく無いアカウントでも空で返る (404にしない)", async () => {
    const view = await fetchView(await createAccount());
    expect(view).toEqual({ referred_by: null, referrals_made: [], established_count: 0 });
  });

  it("存在しないアカウントは404、未認証は401", async () => {
    await fetchView(generateId(), 404);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/accounts/${generateId()}/wallet-user-referrals`)
      .expect(401);
  });
});
