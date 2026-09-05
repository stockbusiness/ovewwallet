import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 利用者プロフィール (氏名・電話・住所) — docs/account-profile.md。
 *
 * ORI付与を入口にしたリスト取りが目的なので、**必須にしてもウォレットは使える**。
 * 入力しない人はそれ自体がセグメントになる。ここではその性質と、管理画面の
 * 設定が利用者側の受け付けにそのまま効くことを確認する。
 */
describe("利用者プロフィール", () => {
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

  /** 設定は単一行なので、テストごとに明示的に戻す (他のテストへ漏らさないため)。 */
  async function setConfig(body: Record<string, unknown>) {
    await request(app.getHttpServer())
      .post("/api/v1/admin/profile-config")
      .set("Cookie", adminCookie)
      .send({ reason: "e2e", ...body })
      .expect(201);
  }

  async function resetConfig() {
    await prisma.accountProfileConfig.deleteMany({ where: { id: "default" } });
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const email = `e2e-profile-admin-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "E2E Profile Admin",
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    adminCookie = login.headers["set-cookie"] as unknown as string[];
  });

  afterEach(async () => {
    await resetConfig();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("利用者による参照と更新", () => {
    it("未入力なら空のプロフィールと既定の設定、そして入力を促す指示が返る", async () => {
      const { cookie } = await createUser();
      const res = await request(app.getHttpServer())
        .get("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .expect(200);

      expect(res.body.profile.fullName).toBeNull();
      expect(res.body.config.fields).toEqual({
        fullName: "OPTIONAL",
        fullNameKana: "HIDDEN",
        phone: "OPTIONAL",
        postalCode: "OPTIONAL",
        address: "OPTIONAL",
      });
      expect(res.body.prompt.show).toBe(true);
    });

    it("指定した項目だけが保存され、電話・郵便番号は数字に揃えられる", async () => {
      const { cookie } = await createUser();
      const res = await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({
          fullName: " 田中  太郎 ",
          phone: "090-1234-5678",
          postalCode: "100-0001",
          prefecture: "東京都",
          city: "千代田区",
          addressLine: "1-1-1",
        })
        .expect(200);

      expect(res.body.profile.fullName).toBe("田中 太郎");
      expect(res.body.profile.phone).toBe("09012345678");
      expect(res.body.profile.postalCode).toBe("1000001");
      expect(res.body.profile.building).toBeNull();
    });

    it("送らなかった項目は現状維持、空文字を送った項目は消える", async () => {
      const { cookie } = await createUser();
      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎", phone: "09012345678" })
        .expect(200);

      const res = await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ phone: "" })
        .expect(200);

      expect(res.body.profile.fullName).toBe("田中太郎");
      expect(res.body.profile.phone).toBeNull();
    });

    it("書式が不正な電話番号・郵便番号・都道府県は400で拒否する", async () => {
      const { cookie } = await createUser();
      for (const body of [{ phone: "1234" }, { postalCode: "12345" }, { prefecture: "東京" }]) {
        await request(app.getHttpServer())
          .put("/api/v1/accounts/me/profile")
          .set("Cookie", cookie)
          .send(body)
          .expect(400);
      }
    });

    it("ログインしていなければ参照も更新もできない", async () => {
      await request(app.getHttpServer()).get("/api/v1/accounts/me/profile").expect(401);
      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .send({ fullName: "田中太郎" })
        .expect(401);
    });
  });

  describe("必須にしてもウォレットは使える", () => {
    it("必須項目が未入力でも残高照会は通り、促す指示だけが返る", async () => {
      // 入力しない人をセグメントとして残すのがこの機能の目的なので、
      // 入口で締め出すと目的そのものが達せられない
      await setConfig({ fullName: "REQUIRED", phone: "REQUIRED" });
      const { cookie } = await createUser();

      await request(app.getHttpServer()).get("/api/v1/me/wallet").set("Cookie", cookie).expect(200);

      const res = await request(app.getHttpServer())
        .get("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.prompt.show).toBe(true);
      expect(res.body.prompt.missingRequired).toEqual(["fullName", "phone"]);
    });

    it("「入力しない」を選ぶと促されなくなるが、断ったことは記録に残る", async () => {
      await setConfig({ fullName: "REQUIRED" });
      const { cookie, oveAccountId } = await createUser();

      const res = await request(app.getHttpServer())
        .post("/api/v1/accounts/me/profile/decline")
        .set("Cookie", cookie)
        .expect(201);

      expect(res.body.prompt.show).toBe(false);
      expect(res.body.profile.declinedAt).not.toBeNull();

      const row = await prisma.accountProfile.findUnique({ where: { oveAccountId } });
      expect(row?.declinedAt).not.toBeNull();
    });

    it("断った後で入力すれば「断った」状態は解除される", async () => {
      const { cookie, oveAccountId } = await createUser();
      await request(app.getHttpServer())
        .post("/api/v1/accounts/me/profile/decline")
        .set("Cookie", cookie)
        .expect(201);

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎" })
        .expect(200);

      const row = await prisma.accountProfile.findUnique({ where: { oveAccountId } });
      expect(row?.declinedAt).toBeNull();
    });
  });

  describe("管理画面の設定が利用者側に効く", () => {
    it("HIDDENにした項目は保存を拒否する (黙って捨てない)", async () => {
      // 捨てると利用者には保存できたように見えてしまう
      await setConfig({ phone: "HIDDEN" });
      const { cookie } = await createUser();

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ phone: "09012345678" })
        .expect(400);

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎" })
        .expect(200);
    });

    it("設定は指定した項目だけが変わり、監査ログが残る", async () => {
      await setConfig({ fullName: "REQUIRED" });
      await setConfig({ phone: "HIDDEN" });

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/profile-config")
        .set("Cookie", adminCookie)
        .expect(200);

      expect(res.body.fields.fullName).toBe("REQUIRED");
      expect(res.body.fields.phone).toBe("HIDDEN");
      expect(res.body.fields.address).toBe("OPTIONAL");

      const logs = await prisma.auditLog.findMany({
        where: { actionType: "ACCOUNT_PROFILE_CONFIG_UPDATED" },
      });
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    it("理由なしの設定変更は拒否する", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/profile-config")
        .set("Cookie", adminCookie)
        .send({ fullName: "REQUIRED" })
        .expect(400);
    });

    it("管理者としてログインしていなければ設定を読めも変えもしない", async () => {
      await request(app.getHttpServer()).get("/api/v1/admin/profile-config").expect(401);
      await request(app.getHttpServer())
        .post("/api/v1/admin/profile-config")
        .send({ fullName: "REQUIRED", reason: "e2e" })
        .expect(401);
    });
  });

  describe("退会後の匿名化", () => {
    it("匿名化するとプロフィールは行ごと消える", async () => {
      const { cookie, oveAccountId } = await createUser();
      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎", phone: "09012345678" })
        .expect(200);

      const { AccountAnonymizationService } = await import("../accounts/account-anonymization.service");
      const service = app.get(AccountAnonymizationService);

      await prisma.oveAccount.update({
        where: { id: oveAccountId },
        data: { status: "CLOSED", closedAt: new Date("2020-01-01T00:00:00Z") },
      });

      process.env.ENABLE_ACCOUNT_ANONYMIZATION = "true";
      process.env.ANONYMIZATION_HASH_KEY = "e2e-profile-anonymization-hash-key";
      try {
        await service.anonymizeClosedAccounts();
      } finally {
        delete process.env.ENABLE_ACCOUNT_ANONYMIZATION;
        delete process.env.ANONYMIZATION_HASH_KEY;
      }

      expect(await prisma.accountProfile.findUnique({ where: { oveAccountId } })).toBeNull();
    });
  });
});
