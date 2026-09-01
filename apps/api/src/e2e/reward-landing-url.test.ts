import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/**
 * 付与ルールの案内先URL (docs/reward-landing-url.md)。
 *
 * 導入前は「ORIを貯める」に特典が並ぶだけで、タップしても「準備中です」と出るだけの
 * 行き止まりだった。参加方法へ誘導する導線が無かった。
 */
describe("付与ルールの案内先URL", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const ruleCode = `E2E_LANDING_${generateId().slice(-8).toUpperCase()}`;

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

  async function publicRules(cookie: string[]) {
    const res = await request(app.getHttpServer())
      .get("/api/v1/rewards/public")
      .set("Cookie", cookie)
      .expect(200);
    return res.body as Array<{
      rule_code: string;
      landing_url: string | null;
      already_earned: boolean;
    }>;
  }

  async function patchRule(body: Record<string, unknown>, expected = 200) {
    return request(app.getHttpServer())
      .patch(`/api/v1/admin/reward-rules/${ruleCode}`)
      .set("Cookie", adminCookie)
      .send(body)
      .expect(expected);
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const email = `landing-admin-${generateId()}@ovewallet.local`;
    const password = "landing-e2e-password";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-LAND-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "Landing E2E Admin",
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    adminCookie = login.headers["set-cookie"] as unknown as string[];

    // AIアート教室特典と同じ形 (1回限りの参加特典) のルールを用意する
    await prisma.rewardRule.create({
      data: {
        id: generateId(),
        ruleCode,
        ruleName: "E2E 参加特典",
        sourceService: "AIART",
        rewardAmount: 10000n,
        perEventLimit: 1,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "E2E 参加特典",
      },
    });
  });

  afterAll(async () => {
    await prisma.rewardRule.deleteMany({ where: { ruleCode } });
    await app.close();
    await prisma.$disconnect();
  });

  describe("管理画面からの設定", () => {
    it("httpsのURLを設定でき、利用者向けAPIに現れる", async () => {
      await patchRule({ landingUrl: "https://lin.ee/e2e-example" });

      const user = await createUser();
      const rule = (await publicRules(user.cookie)).find((r) => r.rule_code === ruleCode);
      expect(rule?.landing_url).toBe("https://lin.ee/e2e-example");
    });

    it("空文字を送ると未設定に戻せる (導線を出さない状態にする)", async () => {
      await patchRule({ landingUrl: "https://lin.ee/e2e-example" });
      await patchRule({ landingUrl: "" });

      const user = await createUser();
      const rule = (await publicRules(user.cookie)).find((r) => r.rule_code === ruleCode);
      expect(rule?.landing_url).toBeNull();
    });

    it("https以外は400で拒否する", async () => {
      // 利用者の画面でそのままリンクになるため、スクリプトを実行しうるスキームを弾く
      for (const url of ["javascript:alert(1)", "http://example.com", "lin.ee/abc"]) {
        await patchRule({ landingUrl: url }, 400);
      }
    });

    it("拒否された場合は値が書き換わらない", async () => {
      await patchRule({ landingUrl: "https://lin.ee/keep-me" });
      await patchRule({ landingUrl: "javascript:alert(1)" }, 400);

      const rule = await prisma.rewardRule.findUniqueOrThrow({ where: { ruleCode } });
      expect(rule.landingUrl).toBe("https://lin.ee/keep-me");
    });
  });

  describe("受け取り済みの判定", () => {
    // 判定は`RULE_CODE_BY_TRANSACTION_TYPE`(rule_code ⇔ transaction_type の対応表) を
    // 使うため、対応表に載っているルールでのみ機能する。実在の参加特典で確かめる。
    const mappedRuleCode = "AIART_ATTENDANCE_REWARD";

    beforeAll(async () => {
      // 他のテストの実行順によっては未作成のことがあるため、無ければ作る (削除はしない)。
      const existing = await prisma.rewardRule.findUnique({ where: { ruleCode: mappedRuleCode } });
      if (!existing) {
        await prisma.rewardRule.create({
          data: {
            id: generateId(),
            ruleCode: mappedRuleCode,
            ruleName: "AIアート教室参加特典",
            sourceService: "AIART",
            rewardAmount: 10000n,
            perEventLimit: 1,
            approvalType: "AUTOMATIC",
            status: "ACTIVE",
            displayName: "AIアート教室参加特典",
          },
        });
      }
    });

    it("未受け取りなら already_earned は false", async () => {
      const user = await createUser();
      const rule = (await publicRules(user.cookie)).find((r) => r.rule_code === mappedRuleCode);
      expect(rule?.already_earned).toBe(false);
    });

    it("受け取り済みなら true になる (1回限りの特典を出し続けないため)", async () => {
      const user = await createUser();
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: user.oveAccountId } });
      await creditWallet({
        walletId: wallet.id,
        amount: 10000,
        transactionType: "AIART_ATTENDANCE",
        idempotencyKey: generateId(),
        displayName: "AIアート教室参加特典",
        createdByType: "EXTERNAL_SERVICE",
      });

      const rule = (await publicRules(user.cookie)).find((r) => r.rule_code === mappedRuleCode);
      expect(rule?.already_earned).toBe(true);
    });

    it("他の利用者の受け取りに影響されない", async () => {
      const other = await createUser();
      const rule = (await publicRules(other.cookie)).find((r) => r.rule_code === mappedRuleCode);
      expect(rule?.already_earned).toBe(false);
    });

    it("対応表に無いルールは常に false (既知の制約)", async () => {
      // rule_code と transaction_type の対応が無いルールは、受け取りを検出できない。
      // 誤って「受け取り済み」と判定して機会を隠すより、出し続ける方が害が小さい。
      // docs/reward-landing-url.md「既知の制約」参照。
      const user = await createUser();
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: user.oveAccountId } });
      await creditWallet({
        walletId: wallet.id,
        amount: 500,
        transactionType: "CAMPAIGN_REWARD",
        idempotencyKey: generateId(),
        displayName: "対応表に無い付与",
        createdByType: "ADMIN",
      });

      const rule = (await publicRules(user.cookie)).find((r) => r.rule_code === ruleCode);
      expect(rule?.already_earned).toBe(false);
    });
  });
});
