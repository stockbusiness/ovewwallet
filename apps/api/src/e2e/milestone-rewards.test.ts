import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import {
  PROFILE_COMPLETION_BONUS_RULE_CODE,
  WALLET_SIGNUP_BONUS_RULE_CODE,
} from "../rewards/milestone-rewards.service";

/**
 * 段階付与 (docs/milestone-rewards.md)。
 *
 * 3000 ORIを一度に配るのをやめ、新規登録1000・お客様情報の登録1000・
 * AIアート教室LINE登録1000 に分ける運用に合わせたもの。ここで扱うのは
 * ウォレットが自分で達成を知っている前2つ (3つ目は当面手動付与)。
 */
describe("段階付与", () => {
  let app: INestApplication;
  let adminCookie: string[];

  async function createUser() {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
      .expect(201);
    return {
      cookie: login.headers["set-cookie"] as unknown as string[],
      oveAccountId: login.body.ove_account_id as string,
    };
  }

  async function transactionsOf(oveAccountId: string, transactionType: string) {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    return prisma.oveTransaction.findMany({
      where: { walletId: wallet.id, transactionType: transactionType as never },
    });
  }

  async function setProfileConfig(body: Record<string, unknown>) {
    await request(app.getHttpServer())
      .post("/api/v1/admin/profile-config")
      .set("Cookie", adminCookie)
      .send({ reason: "e2e", ...body })
      .expect(201);
  }

  const originalFlag = process.env.ENABLE_WALLET_MILESTONE_REWARDS;

  beforeAll(async () => {
    // 既定OFFの機能なので、このテストの中だけ開ける。
    process.env.ENABLE_WALLET_MILESTONE_REWARDS = "true";
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const email = `e2e-milestone-admin-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "E2E Milestone Admin",
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    adminCookie = login.headers["set-cookie"] as unknown as string[];
  });

  afterEach(async () => {
    await prisma.accountProfileConfig.deleteMany({ where: { id: "default" } });
    // 金額・状態を初期値へ戻す (他のテストへ持ち越さない)。
    await prisma.rewardRule.updateMany({
      where: { ruleCode: { in: [WALLET_SIGNUP_BONUS_RULE_CODE, PROFILE_COMPLETION_BONUS_RULE_CODE] } },
      data: { rewardAmount: BigInt(1000), status: "ACTIVE" },
    });
  });

  afterAll(async () => {
    if (originalFlag === undefined) delete process.env.ENABLE_WALLET_MILESTONE_REWARDS;
    else process.env.ENABLE_WALLET_MILESTONE_REWARDS = originalFlag;
    await app.close();
    await prisma.$disconnect();
  });

  describe("新規登録特典", () => {
    it("登録すると1000 ORIが付く", async () => {
      const { oveAccountId } = await createUser();
      const txs = await transactionsOf(oveAccountId, "WALLET_SIGNUP_BONUS");

      expect(txs).toHaveLength(1);
      expect(txs[0]!.amount).toBe(BigInt(1000));
      expect(txs[0]!.direction).toBe("CREDIT");
    });

    it("同じアカウントに二重で付かない", async () => {
      const { cookie, oveAccountId } = await createUser();
      // 再ログインしても登録処理は走らないが、冪等キーでも二重付与を防いでいる
      await request(app.getHttpServer()).get("/api/v1/me/wallet").set("Cookie", cookie).expect(200);

      expect(await transactionsOf(oveAccountId, "WALLET_SIGNUP_BONUS")).toHaveLength(1);
    });

    it("金額は管理画面の付与ルールから読む (コードに埋めない)", async () => {
      await prisma.rewardRule.update({
        where: { ruleCode: WALLET_SIGNUP_BONUS_RULE_CODE },
        data: { rewardAmount: BigInt(1500) },
      });
      const { oveAccountId } = await createUser();

      const txs = await transactionsOf(oveAccountId, "WALLET_SIGNUP_BONUS");
      expect(txs[0]!.amount).toBe(BigInt(1500));
    });

    it("ルールを無効にしても登録自体は成功する (特典が付かないだけ)", async () => {
      // 特典が付かないことより、登録が失敗するほうが害が大きい
      await prisma.rewardRule.update({
        where: { ruleCode: WALLET_SIGNUP_BONUS_RULE_CODE },
        data: { status: "INACTIVE" },
      });
      const { oveAccountId } = await createUser();

      expect(oveAccountId).toBeTruthy();
      expect(await transactionsOf(oveAccountId, "WALLET_SIGNUP_BONUS")).toHaveLength(0);
    });
  });

  describe("お客様情報の登録特典", () => {
    it("必須にした項目がすべて埋まると1000 ORIが付く", async () => {
      await setProfileConfig({ fullName: "REQUIRED", phone: "REQUIRED" });
      const { cookie, oveAccountId } = await createUser();

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎", phone: "09012345678" })
        .expect(200);

      const txs = await transactionsOf(oveAccountId, "PROFILE_COMPLETION_BONUS");
      expect(txs).toHaveLength(1);
      expect(txs[0]!.amount).toBe(BigInt(1000));
    });

    it("必須項目が欠けている間は付かない", async () => {
      await setProfileConfig({ fullName: "REQUIRED", phone: "REQUIRED" });
      const { cookie, oveAccountId } = await createUser();

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎" })
        .expect(200);

      expect(await transactionsOf(oveAccountId, "PROFILE_COMPLETION_BONUS")).toHaveLength(0);
    });

    it("後から残りを埋めたときに付く", async () => {
      await setProfileConfig({ fullName: "REQUIRED", phone: "REQUIRED" });
      const { cookie, oveAccountId } = await createUser();

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎" })
        .expect(200);
      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ phone: "09012345678" })
        .expect(200);

      expect(await transactionsOf(oveAccountId, "PROFILE_COMPLETION_BONUS")).toHaveLength(1);
    });

    it("何度保存し直しても二重で付かない", async () => {
      await setProfileConfig({ fullName: "REQUIRED" });
      const { cookie, oveAccountId } = await createUser();

      for (const name of ["田中太郎", "田中次郎", "田中三郎"]) {
        await request(app.getHttpServer())
          .put("/api/v1/accounts/me/profile")
          .set("Cookie", cookie)
          .send({ fullName: name })
          .expect(200);
      }

      expect(await transactionsOf(oveAccountId, "PROFILE_COMPLETION_BONUS")).toHaveLength(1);
    });

    it("必須項目が1つも無ければ付かない", async () => {
      // 埋めるべきものが無い状態を完了と扱うと、何も入力していない人に特典が出てしまう
      await setProfileConfig({ fullName: "OPTIONAL", phone: "OPTIONAL" });
      const { cookie, oveAccountId } = await createUser();

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎", phone: "09012345678" })
        .expect(200);

      expect(await transactionsOf(oveAccountId, "PROFILE_COMPLETION_BONUS")).toHaveLength(0);
    });

    it("「入力しない」を選んだだけでは付かない", async () => {
      await setProfileConfig({ fullName: "REQUIRED" });
      const { cookie, oveAccountId } = await createUser();

      await request(app.getHttpServer())
        .post("/api/v1/accounts/me/profile/decline")
        .set("Cookie", cookie)
        .expect(201);

      expect(await transactionsOf(oveAccountId, "PROFILE_COMPLETION_BONUS")).toHaveLength(0);
    });
  });

  describe("Feature Flag", () => {
    it("無効なら1つも付かない (代理店の3000を止めるまで開けない)", async () => {
      process.env.ENABLE_WALLET_MILESTONE_REWARDS = "false";
      try {
        await setProfileConfig({ fullName: "REQUIRED" });
        const { cookie, oveAccountId } = await createUser();
        await request(app.getHttpServer())
          .put("/api/v1/accounts/me/profile")
          .set("Cookie", cookie)
          .send({ fullName: "田中太郎" })
          .expect(200);

        expect(await transactionsOf(oveAccountId, "WALLET_SIGNUP_BONUS")).toHaveLength(0);
        expect(await transactionsOf(oveAccountId, "PROFILE_COMPLETION_BONUS")).toHaveLength(0);
      } finally {
        process.env.ENABLE_WALLET_MILESTONE_REWARDS = "true";
      }
    });
  });

  describe("合計", () => {
    it("登録とお客様情報で2000 ORIになる (残り1000はAIアート教室分)", async () => {
      await setProfileConfig({ fullName: "REQUIRED" });
      const { cookie, oveAccountId } = await createUser();

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎" })
        .expect(200);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
      expect(wallet.availableBalance).toBe(BigInt(2000));
    });
  });
});
