import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { CURRENT_TERMS_VERSION } from "../accounts/account-registration.service";
import { TERMS_CONSENT_REQUIRED_CODE } from "../accounts/terms-consent";

/**
 * 規約改定後の再同意 (docs/terms-consent.md)。
 *
 * 導入前は`terms_version`をアカウントに記録していたが、現行バージョンと突き合わせる
 * 処理がどこにも無く、規約を改定しても既存利用者に同意を求める手段が無かった。
 */
describe("利用規約の再同意", () => {
  let app: INestApplication;

  /** ログイン済みの利用者を作る。`agreedVersion`で同意済みバージョンを差し替える。 */
  async function createUser(agreedVersion?: string | null) {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
      .expect(201);
    const cookie = login.headers["set-cookie"] as unknown as string[];
    const oveAccountId = login.body.ove_account_id as string;

    if (agreedVersion !== undefined) {
      await prisma.oveAccount.update({
        where: { id: oveAccountId },
        data: { termsVersion: agreedVersion },
      });
    }
    return { cookie, oveAccountId };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("同意状態の参照", () => {
    it("現行バージョンに同意済みなら再同意は不要", async () => {
      const { cookie } = await createUser();
      const res = await request(app.getHttpServer())
        .get("/api/v1/accounts/me/terms")
        .set("Cookie", cookie)
        .expect(200);

      expect(res.body.current_version).toBe(CURRENT_TERMS_VERSION);
      expect(res.body.agreed_version).toBe(CURRENT_TERMS_VERSION);
      expect(res.body.consent_required).toBe(false);
      expect(res.body.agreed_at).not.toBeNull();
    });

    it("古いバージョンに同意している場合は再同意が必要", async () => {
      const { cookie } = await createUser("0.9");
      const res = await request(app.getHttpServer())
        .get("/api/v1/accounts/me/terms")
        .set("Cookie", cookie)
        .expect(200);

      expect(res.body.agreed_version).toBe("0.9");
      expect(res.body.consent_required).toBe(true);
    });

    it("同意の記録が無いアカウントも再同意の対象にする", async () => {
      // 「記録が無い」と「同意していない」は区別できないので、安全側に倒す
      const { cookie } = await createUser(null);
      const res = await request(app.getHttpServer())
        .get("/api/v1/accounts/me/terms")
        .set("Cookie", cookie)
        .expect(200);

      expect(res.body.agreed_version).toBeNull();
      expect(res.body.consent_required).toBe(true);
    });
  });

  describe("再同意するまで更新系を拒否する", () => {
    it("更新系は403で、機械可読コードを返す", async () => {
      const { cookie } = await createUser("0.9");
      const res = await request(app.getHttpServer())
        .post("/api/v1/me/daily-bonus/claim")
        .set("Cookie", cookie)
        .expect(403);

      // フロントは英語のメッセージではなくこのコードで再同意画面へ誘導する
      expect(res.body.error).toBe(TERMS_CONSENT_REQUIRED_CODE);
    });

    it("閲覧は通す (残高が見えないと不安を招くだけで、同意を促す効果が無い)", async () => {
      const { cookie } = await createUser("0.9");
      await request(app.getHttpServer()).get("/api/v1/me/wallet").set("Cookie", cookie).expect(200);
      await request(app.getHttpServer()).get("/api/v1/me/notices").set("Cookie", cookie).expect(200);
      await request(app.getHttpServer()).get("/api/v1/accounts/me").set("Cookie", cookie).expect(200);
    });

    it("同意済みの利用者は従来どおり更新系を実行できる", async () => {
      const { cookie } = await createUser();
      await request(app.getHttpServer())
        .post("/api/v1/me/daily-bonus/claim")
        .set("Cookie", cookie)
        .expect(201);
    });
  });

  describe("同意すると解除される", () => {
    it("同意後は更新系が通り、記録も更新される", async () => {
      const { cookie, oveAccountId } = await createUser("0.9");
      await request(app.getHttpServer())
        .post("/api/v1/me/daily-bonus/claim")
        .set("Cookie", cookie)
        .expect(403);

      const accepted = await request(app.getHttpServer())
        .post("/api/v1/accounts/me/terms/accept")
        .set("Cookie", cookie)
        .expect(201);
      expect(accepted.body.consent_required).toBe(false);
      expect(accepted.body.agreed_version).toBe(CURRENT_TERMS_VERSION);

      const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
      expect(account.termsVersion).toBe(CURRENT_TERMS_VERSION);
      expect(account.termsAgreedAt).not.toBeNull();

      await request(app.getHttpServer())
        .post("/api/v1/me/daily-bonus/claim")
        .set("Cookie", cookie)
        .expect(201);
    });
  });

  describe("同意しない利用者に残す出口", () => {
    it("同意そのものは拒否されない (でないと同意できず詰む)", async () => {
      const { cookie } = await createUser("0.9");
      await request(app.getHttpServer())
        .post("/api/v1/accounts/me/terms/accept")
        .set("Cookie", cookie)
        .expect(201);
    });

    it("ログアウトできる", async () => {
      const { cookie } = await createUser("0.9");
      await request(app.getHttpServer()).post("/api/v1/auth/logout").set("Cookie", cookie).expect(201);
    });

    it("退会できる (サービスを離れる手段まで奪わない)", async () => {
      const { cookie } = await createUser("0.9");
      await request(app.getHttpServer()).post("/api/v1/accounts/me/close").set("Cookie", cookie).expect(201);
    });
  });

  describe("未ログイン", () => {
    it("同意状態の参照にもログインが必要", async () => {
      await request(app.getHttpServer()).get("/api/v1/accounts/me/terms").expect(401);
    });
  });
});
