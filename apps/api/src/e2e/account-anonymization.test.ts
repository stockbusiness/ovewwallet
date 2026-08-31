import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { AccountAnonymizationService } from "../accounts/account-anonymization.service";
import { ANONYMIZED_SUBJECT_PREFIX } from "../accounts/anonymized-identity";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 退会済みアカウントの匿名化 (docs/account-anonymization.md)。
 *
 * 導入前の退会は`status = CLOSED`を立てるだけで、氏名・メールアドレス・電話番号・
 * LINEユーザーIDはすべて残ったままだった。
 */
describe("退会済みアカウントの匿名化", () => {
  let app: INestApplication;
  let service: AccountAnonymizationService;
  const originalFlag = process.env.ENABLE_ACCOUNT_ANONYMIZATION;
  const originalKey = process.env.ANONYMIZATION_HASH_KEY;
  const hashKey = "anonymization-e2e-hash-key";

  /** 退会済みで、猶予期間を過ぎたアカウントを作る。 */
  async function createClosedAccount(options: { closedDaysAgo: number; idToken?: string }) {
    const idToken = options.idToken ?? `mock.${generateId()}`;
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken, termsAccepted: true })
      .expect(201);
    const oveAccountId = login.body.ove_account_id as string;

    await prisma.oveAccount.update({
      where: { id: oveAccountId },
      data: {
        displayName: "匿名化テスト太郎",
        primaryEmail: `anonymization-${generateId()}@ovewallet.local`,
        primaryPhone: "09012345678",
        status: "CLOSED",
        closedAt: new Date(Date.now() - options.closedDaysAgo * DAY_MS),
      },
    });
    await prisma.userSession.updateMany({
      where: { oveAccountId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "USER_ACCOUNT_CLOSURE" },
    });
    return { oveAccountId, idToken };
  }

  async function accountOf(id: string) {
    return prisma.oveAccount.findUniqueOrThrow({
      where: { id },
      include: { identities: true },
    });
  }

  beforeAll(async () => {
    process.env.ENABLE_ACCOUNT_ANONYMIZATION = "true";
    process.env.ANONYMIZATION_HASH_KEY = hashKey;
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    service = app.get(AccountAnonymizationService);
  });

  afterAll(async () => {
    if (originalFlag === undefined) delete process.env.ENABLE_ACCOUNT_ANONYMIZATION;
    else process.env.ENABLE_ACCOUNT_ANONYMIZATION = originalFlag;
    if (originalKey === undefined) delete process.env.ANONYMIZATION_HASH_KEY;
    else process.env.ANONYMIZATION_HASH_KEY = originalKey;
    await app.close();
    await prisma.$disconnect();
  });

  describe("消すもの・残すもの", () => {
    it("氏名・メール・電話とidentityの連絡先を消し、provider_subjectをハッシュに置き換える", async () => {
      const { oveAccountId } = await createClosedAccount({ closedDaysAgo: 200 });
      const before = await accountOf(oveAccountId);
      const rawSubject = before.identities[0]!.providerSubject;

      await service.anonymizeClosedAccounts();

      const after = await accountOf(oveAccountId);
      expect(after.displayName).toBeNull();
      expect(after.primaryEmail).toBeNull();
      expect(after.primaryPhone).toBeNull();

      const identity = after.identities[0]!;
      expect(identity.email).toBeNull();
      expect(identity.phone).toBeNull();
      expect(identity.metadata).toBeNull();
      // 生のLINEユーザーIDは残さない
      expect(identity.providerSubject).not.toBe(rawSubject);
      expect(identity.providerSubject).not.toContain(rawSubject);
      expect(identity.providerSubject.startsWith(ANONYMIZED_SUBJECT_PREFIX)).toBe(true);
    });

    it("取引履歴は消さない (会計・監査要件、DBトリガーでも保護)", async () => {
      const { oveAccountId } = await createClosedAccount({ closedDaysAgo: 200 });
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });

      await service.anonymizeClosedAccounts();

      // ウォレットとアカウントの行自体は残る (取引から外部キーで参照されているため)
      expect(await prisma.wallet.findUnique({ where: { id: wallet.id } })).not.toBeNull();
      expect(await prisma.oveAccount.findUnique({ where: { id: oveAccountId } })).not.toBeNull();
    });

    it("監査ログを残す (何を消したかは残すが、消した値そのものは残さない)", async () => {
      const { oveAccountId } = await createClosedAccount({ closedDaysAgo: 200 });
      await service.anonymizeClosedAccounts();

      const log = await prisma.auditLog.findFirst({
        where: { targetId: oveAccountId, actionType: "ACCOUNT_ANONYMIZED" },
      });
      expect(log).not.toBeNull();
      expect(log?.result).toBe("SUCCESS");
      expect(log?.beforeData).toBeNull();
    });
  });

  describe("対象の絞り込み", () => {
    it("猶予期間内の退会は対象外", async () => {
      const { oveAccountId } = await createClosedAccount({ closedDaysAgo: 10 });
      await service.anonymizeClosedAccounts();
      expect((await accountOf(oveAccountId)).displayName).toBe("匿名化テスト太郎");
    });

    it("退会していないアカウントは対象外", async () => {
      const login = await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
        .expect(201);
      const oveAccountId = login.body.ove_account_id as string;
      await prisma.oveAccount.update({
        where: { id: oveAccountId },
        data: { displayName: "現役ユーザー" },
      });

      await service.anonymizeClosedAccounts();
      expect((await accountOf(oveAccountId)).displayName).toBe("現役ユーザー");
    });

    it("2回実行しても既に匿名化済みの行は作り直さない", async () => {
      const { oveAccountId } = await createClosedAccount({ closedDaysAgo: 200 });
      await service.anonymizeClosedAccounts();
      const first = (await accountOf(oveAccountId)).identities[0]!.providerSubject;

      await service.anonymizeClosedAccounts();
      expect((await accountOf(oveAccountId)).identities[0]!.providerSubject).toBe(first);

      // 監査ログも1件だけ (毎回書くと退会者数に比例して増える)
      const logs = await prisma.auditLog.count({
        where: { targetId: oveAccountId, actionType: "ACCOUNT_ANONYMIZED" },
      });
      expect(logs).toBe(1);
    });
  });

  describe("再登録のブロックが匿名化後も効く", () => {
    it("匿名化した後でも、同じLINEユーザーIDでの再登録を拒否する", async () => {
      const idToken = `mock.${generateId()}`;
      const { oveAccountId } = await createClosedAccount({ closedDaysAgo: 200, idToken });

      await service.anonymizeClosedAccounts();
      expect((await accountOf(oveAccountId)).identities[0]!.providerSubject.startsWith(
        ANONYMIZED_SUBJECT_PREFIX,
      )).toBe(true);

      // ここが本丸。生のproviderSubjectだけで照合していると、匿名化済みの行に
      // 当たらず「新規ユーザー」として通ってしまう
      // (docs/account-closure.md が禁じている経路)。
      await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken, termsAccepted: true })
        .expect(403);
    });

    it("別のLINEユーザーIDでの新規登録は通常どおりできる", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/line/login")
        .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
        .expect(201);
    });
  });

  describe("安全側の作り", () => {
    it("Feature Flagが無効なら1件も消さない", async () => {
      process.env.ENABLE_ACCOUNT_ANONYMIZATION = "false";
      try {
        const { oveAccountId } = await createClosedAccount({ closedDaysAgo: 200 });
        const result = await service.anonymizeClosedAccounts();
        expect(result.skippedReason).toBe("disabled");
        expect(result.anonymizedAccounts).toBe(0);
        expect((await accountOf(oveAccountId)).displayName).toBe("匿名化テスト太郎");
      } finally {
        process.env.ENABLE_ACCOUNT_ANONYMIZATION = "true";
      }
    });

    it("ハッシュ鍵が未設定なら、有効でも実行しない (照合不能なハッシュを書き込まないため)", async () => {
      delete process.env.ANONYMIZATION_HASH_KEY;
      try {
        const { oveAccountId } = await createClosedAccount({ closedDaysAgo: 200 });
        const result = await service.anonymizeClosedAccounts();
        expect(result.skippedReason).toBe("hash-key-missing");
        expect((await accountOf(oveAccountId)).displayName).toBe("匿名化テスト太郎");
      } finally {
        process.env.ANONYMIZATION_HASH_KEY = hashKey;
      }
    });
  });

  describe("ドライラン", () => {
    it("対象件数と設定状況を返し、個人情報は返さない", async () => {
      await createClosedAccount({ closedDaysAgo: 200 });
      const preview = await service.preview();

      expect(preview.eligibleAccounts).toBeGreaterThan(0);
      expect(preview.enabled).toBe(true);
      expect(preview.hashKeyConfigured).toBe(true);
      expect(preview.graceDays).toBe(90);
      expect(Object.keys(preview).sort()).toEqual(
        ["closedBefore", "eligibleAccounts", "enabled", "graceDays", "hashKeyConfigured"].sort(),
      );
    });

    it("SUPER_ADMINのみ参照できる", async () => {
      const password = "anonymization-preview-password";
      const make = async (role: "SUPER_ADMIN" | "OVE_OPERATOR") => {
        const email = `anon-preview-${role}-${generateId()}@ovewallet.local`;
        await prisma.adminUser.create({
          data: {
            id: generateId(),
            adminCode: `OVE-ADM-ANON-${generateId()}`,
            email,
            passwordHash: hashSecret(password),
            role,
            displayName: `Anon ${role}`,
          },
        });
        const login = await request(app.getHttpServer())
          .post("/api/v1/admin/login")
          .send({ email, password })
          .expect(201);
        return login.headers["set-cookie"] as unknown as string[];
      };

      await request(app.getHttpServer())
        .get("/api/v1/admin/accounts/anonymization-preview")
        .set("Cookie", await make("SUPER_ADMIN"))
        .expect(200);

      await request(app.getHttpServer())
        .get("/api/v1/admin/accounts/anonymization-preview")
        .set("Cookie", await make("OVE_OPERATOR"))
        .expect(403);
    });
  });
});
