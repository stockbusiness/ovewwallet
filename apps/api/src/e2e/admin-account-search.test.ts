import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 管理画面のアカウント検索。
 *
 * 導入前は絞り込みが状態のみで、問い合わせを受けても利用者を特定する手段が無かった
 * (取引一覧はアカウントコードで引けるが、そのコードをメールアドレス等から
 * 辿る入口が無かった)。
 */
describe("管理画面のアカウント検索", () => {
  let app: INestApplication;
  let cookie: string[];
  const tag = generateId().slice(-10);
  const email = `search-target-${tag}@ovewallet.local`;
  const displayName = `検索対象ユーザー${tag}`;
  const phone = `090${tag.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`;
  let accountCode: string;
  let otherAccountCode: string;

  async function createAccount(overrides: {
    displayName?: string;
    primaryEmail?: string;
    primaryPhone?: string;
    commonUserId?: string;
    status?: "ACTIVE" | "CLOSED";
  }) {
    const code = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    await prisma.oveAccount.create({
      data: {
        id: generateId(),
        accountCode: code,
        status: overrides.status ?? "ACTIVE",
        displayName: overrides.displayName,
        primaryEmail: overrides.primaryEmail,
        primaryPhone: overrides.primaryPhone,
        commonUserId: overrides.commonUserId,
      },
    });
    return code;
  }

  async function search(params: Record<string, string>) {
    const query = new URLSearchParams({ limit: "200", ...params }).toString();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/accounts?${query}`)
      .set("Cookie", cookie)
      .expect(200);
    return res.body as Array<{ accountCode: string }>;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `account-search-admin-${generateId()}@ovewallet.local`;
    const password = "account-search-e2e-password";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-SEARCH-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "Search E2E Admin",
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password })
      .expect(201);
    cookie = login.headers["set-cookie"] as unknown as string[];

    accountCode = await createAccount({
      displayName,
      primaryEmail: email,
      primaryPhone: phone,
      commonUserId: `cu-${tag}`,
    });
    otherAccountCode = await createAccount({
      displayName: `無関係ユーザー${tag}`,
      primaryEmail: `unrelated-${tag}@ovewallet.local`,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("finds the account by full email address", async () => {
    const found = await search({ search: email });
    expect(found.map((a) => a.accountCode)).toEqual([accountCode]);
  });

  it("finds the account by account code", async () => {
    const found = await search({ search: accountCode });
    expect(found.map((a) => a.accountCode)).toEqual([accountCode]);
  });

  it("finds the account by display name, phone number and common_user_id", async () => {
    expect((await search({ search: displayName })).map((a) => a.accountCode)).toEqual([accountCode]);
    expect((await search({ search: phone })).map((a) => a.accountCode)).toEqual([accountCode]);
    expect((await search({ search: `cu-${tag}` })).map((a) => a.accountCode)).toEqual([accountCode]);
  });

  it("matches partially and ignores letter case", async () => {
    // 問い合わせでメールアドレスの一部しか分からない場合を想定する
    const partial = await search({ search: `search-target-${tag}` });
    expect(partial.map((a) => a.accountCode)).toContain(accountCode);

    const upperCased = await search({ search: email.toUpperCase() });
    expect(upperCased.map((a) => a.accountCode)).toContain(accountCode);
  });

  it("returns an empty list when nothing matches", async () => {
    expect(await search({ search: `no-such-user-${generateId()}` })).toEqual([]);
  });

  it("treats a blank search as no filter", async () => {
    // 検索欄を空にしたときに0件にならないこと
    const blank = await search({ search: "   " });
    expect(blank.length).toBeGreaterThan(0);
  });

  it("combines the search with the status filter", async () => {
    const closedCode = await createAccount({
      displayName: `退会済み${tag}`,
      primaryEmail: `closed-${tag}@ovewallet.local`,
      status: "CLOSED",
    });

    // 同じ検索語でも状態で絞れる (tagは両方に含まれる)
    const closedOnly = await search({ search: tag, status: "CLOSED" });
    expect(closedOnly.map((a) => a.accountCode)).toEqual([closedCode]);

    const activeOnly = await search({ search: tag, status: "ACTIVE" });
    expect(activeOnly.map((a) => a.accountCode)).toContain(accountCode);
    expect(activeOnly.map((a) => a.accountCode)).not.toContain(closedCode);
  });

  it("does not return accounts that do not match", async () => {
    const found = await search({ search: email });
    expect(found.map((a) => a.accountCode)).not.toContain(otherAccountCode);
  });

  it("applies the same filter to the CSV export", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/accounts/export?search=${encodeURIComponent(email)}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(res.text).toContain(accountCode);
    expect(res.text).not.toContain(otherAccountCode);
  });
});
