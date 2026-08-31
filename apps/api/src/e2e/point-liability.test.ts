import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER, WALLET_CODE_COUNTER } from "@ove/database";
import { creditWallet, debitWallet, holdBalance, reverseTransaction } from "@ove/ledger";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { PointLiabilityService } from "../reporting/point-liability.service";
import type { CurrentLiability, LiabilityRollForwardPeriod } from "../reporting/point-liability.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ポイント負債レポート (docs/point-liability.md)。
 *
 * 会計に渡す数字なので、合計が合うことを他のテストが作ったデータに影響されない形で
 * 検証する。全社集計のためテストDBの既存データが必ず混ざるので、**変化量**
 * (施行前後の差) を見る。
 */
describe("ポイント負債レポート", () => {
  let app: INestApplication;
  let service: PointLiabilityService;
  let adminCookie: string[];
  let auditorCookie: string[];

  async function createWallet(): Promise<string> {
    const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const account = await prisma.oveAccount.create({
      data: { id: generateId(), accountCode, status: "ACTIVE", displayName: "負債レポートE2E" },
    });
    const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
    const wallet = await prisma.wallet.create({
      data: { id: generateId(), oveAccountId: account.id, walletCode, status: "ACTIVE" },
    });
    return wallet.id;
  }

  async function createAdmin(role: "SUPER_ADMIN" | "AUDITOR" | "EVENT_OPERATOR"): Promise<string[]> {
    const email = `liability-${role}-${generateId()}@ovewallet.local`;
    const password = "liability-e2e-password";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-LIA-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role,
        displayName: `Liability ${role}`,
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    return login.headers["set-cookie"] as unknown as string[];
  }

  async function currentTotal(): Promise<bigint> {
    return BigInt((await service.getCurrentLiability()).totalBalance);
  }

  async function thisMonth(): Promise<LiabilityRollForwardPeriod> {
    const rows = await service.getRollForward(1);
    return rows[0]!;
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    service = app.get(PointLiabilityService);
    adminCookie = await createAdmin("SUPER_ADMIN");
    auditorCookie = await createAdmin("AUDITOR");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("負債の定義", () => {
    it("付与した分だけ負債が増える", async () => {
      const before = await currentTotal();
      const walletId = await createWallet();
      await creditWallet({
        walletId,
        amount: 5000,
        transactionType: "ADMIN_GRANT",
        idempotencyKey: generateId(),
        displayName: "負債テスト付与",
        createdByType: "ADMIN",
      });
      expect((await currentTotal()) - before).toBe(5000n);
    });

    it("利用した分だけ負債が減る", async () => {
      const walletId = await createWallet();
      await creditWallet({
        walletId,
        amount: 3000,
        transactionType: "ADMIN_GRANT",
        idempotencyKey: generateId(),
        displayName: "負債テスト付与",
        createdByType: "ADMIN",
      });
      const before = await currentTotal();
      await debitWallet({
        walletId,
        amount: 1200,
        transactionType: "ITEM_EXCHANGE",
        idempotencyKey: generateId(),
        displayName: "負債テスト利用",
        createdByType: "USER",
      });
      expect((await currentTotal()) - before).toBe(-1200n);
    });

    it("保留(HOLD)は負債を変えない (利用者への債務は残っているため)", async () => {
      const walletId = await createWallet();
      await creditWallet({
        walletId,
        amount: 2000,
        transactionType: "ADMIN_GRANT",
        idempotencyKey: generateId(),
        displayName: "負債テスト付与",
        createdByType: "ADMIN",
      });
      const before = await service.getCurrentLiability();

      await holdBalance({
        walletId,
        amount: 800,
        reason: "負債テスト保留",
        idempotencyKey: generateId(),
        createdBy: "liability-e2e",
      });

      const after = await service.getCurrentLiability();
      // 合計は変わらず、available から held へ移るだけ
      expect(BigInt(after.totalBalance) - BigInt(before.totalBalance)).toBe(0n);
      expect(BigInt(after.availableBalance) - BigInt(before.availableBalance)).toBe(-800n);
      expect(BigInt(after.heldBalance) - BigInt(before.heldBalance)).toBe(800n);
    });
  });

  describe("月次増減表", () => {
    it("付与・利用・取消が増減表の正しい欄に入り、期末残高と整合する", async () => {
      const walletId = await createWallet();
      const before = await thisMonth();

      const grant = await creditWallet({
        walletId,
        amount: 10000,
        transactionType: "ADMIN_GRANT",
        idempotencyKey: generateId(),
        displayName: "増減表テスト付与",
        createdByType: "ADMIN",
      });
      await debitWallet({
        walletId,
        amount: 2500,
        transactionType: "ITEM_EXCHANGE",
        idempotencyKey: generateId(),
        displayName: "増減表テスト利用",
        createdByType: "USER",
      });
      // 別途、取消される付与
      const toReverse = await creditWallet({
        walletId,
        amount: 4000,
        transactionType: "CAMPAIGN_REWARD",
        idempotencyKey: generateId(),
        displayName: "増減表テスト取消対象",
        createdByType: "ADMIN",
      });
      await reverseTransaction({
        transactionId: toReverse.id,
        reason: "増減表テスト",
        idempotencyKey: generateId(),
        createdByType: "ADMIN",
      });

      const after = await thisMonth();
      const delta = (key: "issued" | "used" | "reversedIssuance") =>
        BigInt(after.movement[key]) - BigInt(before.movement[key]);

      expect(delta("issued")).toBe(14000n); // 10000 + 4000
      expect(delta("used")).toBe(2500n);
      expect(delta("reversedIssuance")).toBe(4000n);

      // 実際の残高の動きと一致する: +10000 -2500 +4000 -4000 = 7500
      expect(BigInt(after.closingBalance) - BigInt(before.closingBalance)).toBe(7500n);
      expect(grant.id).toBeDefined();
    });

    it("保留は増減表に載らない (発行にも利用にも入らない)", async () => {
      const walletId = await createWallet();
      await creditWallet({
        walletId,
        amount: 1000,
        transactionType: "ADMIN_GRANT",
        idempotencyKey: generateId(),
        displayName: "増減表テスト付与",
        createdByType: "ADMIN",
      });
      const before = await thisMonth();

      await holdBalance({
        walletId,
        amount: 400,
        reason: "増減表テスト保留",
        idempotencyKey: generateId(),
        createdBy: "liability-e2e",
      });

      const after = await thisMonth();
      expect(BigInt(after.movement.issued) - BigInt(before.movement.issued)).toBe(0n);
      expect(BigInt(after.movement.used) - BigInt(before.movement.used)).toBe(0n);
    });

    it("当月は期末残高が集計時点の実残高になる", async () => {
      const row = await thisMonth();
      expect(row.closingSource).toBe("live");
      expect(row.closingBalance).toBe((await currentTotal()).toString());
    });

    it("増減の欄はすべて0以上 (CSVで負の数が文字列化されないため)", async () => {
      const rows = await service.getRollForward(3);
      for (const row of rows) {
        for (const value of Object.values(row.movement)) {
          expect(BigInt(value)).toBeGreaterThanOrEqual(0n);
        }
      }
    });
  });

  describe("失効見込み", () => {
    it("期限付きロットが期間ごとに集計される", async () => {
      const walletId = await createWallet();
      const before = await service.getCurrentLiability();
      const amountIn = (l: CurrentLiability, days: number) =>
        BigInt(l.expiryForecast.find((b) => b.withinDays === days)!.amount);

      await creditWallet({
        walletId,
        amount: 700,
        transactionType: "CAMPAIGN_REWARD",
        idempotencyKey: generateId(),
        displayName: "失効見込みテスト",
        createdByType: "ADMIN",
        expiresAt: new Date(Date.now() + 10 * DAY_MS),
      });
      await creditWallet({
        walletId,
        amount: 900,
        transactionType: "CAMPAIGN_REWARD",
        idempotencyKey: generateId(),
        displayName: "失効見込みテスト",
        createdByType: "ADMIN",
        expiresAt: new Date(Date.now() + 75 * DAY_MS),
      });

      const after = await service.getCurrentLiability();
      expect(amountIn(after, 30) - amountIn(before, 30)).toBe(700n);
      expect(amountIn(after, 60) - amountIn(before, 60)).toBe(700n);
      expect(amountIn(after, 90) - amountIn(before, 90)).toBe(1600n);
      // 期限付きの残は負債合計を超えない
      expect(BigInt(after.expiringBalance)).toBeLessThanOrEqual(BigInt(after.totalBalance));
    });
  });

  describe("月末スナップショット", () => {
    it("集計時点の実残高ではなく月末時点の残高を記録する", async () => {
      const period = PointLiabilityService.previousPeriod();
      // 先に記録しておく (この時点の残高が「月末残高」として確定する)
      await prisma.pointLiabilitySnapshot.deleteMany({});
      await service.captureMonthEndSnapshot(period);
      const first = await prisma.pointLiabilitySnapshot.findFirstOrThrow();

      // 月末より後 (=今月) に付与しても、前月末の残高は動かない
      const walletId = await createWallet();
      await creditWallet({
        walletId,
        amount: 6000,
        transactionType: "ADMIN_GRANT",
        idempotencyKey: generateId(),
        displayName: "スナップショット後の付与",
        createdByType: "ADMIN",
      });

      await prisma.pointLiabilitySnapshot.deleteMany({});
      await service.captureMonthEndSnapshot(period);
      const second = await prisma.pointLiabilitySnapshot.findFirstOrThrow();

      // 実残高は増えているが、月末時点の残高は同じ
      expect(second.balanceAtCapture - first.balanceAtCapture).toBe(6000n);
      expect(second.totalBalance).toBe(first.totalBalance);
    });

    it("同じ月を二重に記録しない (締めた数字を動かさない)", async () => {
      const period = PointLiabilityService.previousPeriod();
      await prisma.pointLiabilitySnapshot.deleteMany({});
      expect(await service.captureMonthEndSnapshot(period)).toEqual({ created: true });
      expect(await service.captureMonthEndSnapshot(period)).toEqual({ created: false });
      expect(await prisma.pointLiabilitySnapshot.count()).toBe(1);
    });

    it("まだ終わっていない月は締められない", async () => {
      const now = new Date();
      const thisPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      await expect(service.captureMonthEndSnapshot(thisPeriod)).rejects.toThrow("has not ended yet");
    });

    it("前月のスナップショットが当月の期首残高になり、検算が合う", async () => {
      await prisma.pointLiabilitySnapshot.deleteMany({});
      await service.captureMonthEndSnapshot(PointLiabilityService.previousPeriod());
      const snapshot = await prisma.pointLiabilitySnapshot.findFirstOrThrow();

      const row = await thisMonth();
      expect(row.openingBalance).toBe(snapshot.totalBalance.toString());
      expect(row.discrepancy).toBe("0");
    });

    it("台帳を経由しない残高変更を検算で検知できる", async () => {
      // 上の検算は、期首を同じ集計関数から作っている限り必ず0になる (誤差が相殺される)。
      // 実際に意味があるのは「期首が独立に決まっている」場合なので、ずれた期首を
      // 意図的に置いて、差異として現れることを確かめる。
      await prisma.pointLiabilitySnapshot.deleteMany({});
      await service.captureMonthEndSnapshot(PointLiabilityService.previousPeriod());
      const snapshot = await prisma.pointLiabilitySnapshot.findFirstOrThrow();

      const drift = 1234n;
      await prisma.pointLiabilitySnapshot.update({
        where: { id: snapshot.id },
        data: { totalBalance: snapshot.totalBalance - drift },
      });

      const row = await thisMonth();
      // 期首が実際より少ない → 期末との差が埋まらず、その分が差異として出る
      expect(row.discrepancy).toBe(drift.toString());
    });
  });

  describe("権限", () => {
    it("SUPER_ADMIN と AUDITOR は閲覧できる", async () => {
      for (const cookie of [adminCookie, auditorCookie]) {
        await request(app.getHttpServer())
          .get("/api/v1/admin/reports/point-liability")
          .set("Cookie", cookie)
          .expect(200);
      }
    });

    it("それ以外のロールは閲覧できない", async () => {
      const operator = await createAdmin("EVENT_OPERATOR");
      await request(app.getHttpServer())
        .get("/api/v1/admin/reports/point-liability")
        .set("Cookie", operator)
        .expect(403);
    });

    it("未ログインは401", async () => {
      await request(app.getHttpServer()).get("/api/v1/admin/reports/point-liability").expect(401);
    });
  });

  describe("CSV", () => {
    it("ヘッダーと月次の行を返す", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/reports/point-liability/roll-forward/export?months=2")
        .set("Cookie", adminCookie)
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/csv");
      const lines = res.text.split("\r\n");
      expect(lines[0]).toContain("対象月");
      expect(lines[0]).toContain("期末残高");
      expect(lines).toHaveLength(3); // ヘッダー + 2か月
    });
  });
});
