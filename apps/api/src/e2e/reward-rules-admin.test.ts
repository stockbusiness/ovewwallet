import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

describe("admin reward rule management (指示書13章)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-rules-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Reward Rules Admin",
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = loginRes.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("creates a rule, rejects a duplicate ruleCode, and updates it", async () => {
    const ruleCode = `E2E_TEST_RULE_${generateId()}`;

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/admin/reward-rules")
      .set("Cookie", adminCookie)
      .send({
        ruleCode,
        ruleName: "テストルール",
        sourceService: "EVENT_SYSTEM",
        rewardAmount: 500,
        displayName: "テストイベント参加特典",
        perUserLimit: 1,
      })
      .expect(201);
    expect(createRes.body.status).toBe("ACTIVE");
    expect(createRes.body.rewardAmount).toBe("500");

    await request(app.getHttpServer())
      .post("/api/v1/admin/reward-rules")
      .set("Cookie", adminCookie)
      .send({
        ruleCode,
        ruleName: "重複",
        sourceService: "EVENT_SYSTEM",
        rewardAmount: 100,
        displayName: "重複ルール",
      })
      .expect(409);

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/admin/reward-rules/${ruleCode}`)
      .set("Cookie", adminCookie)
      .send({ status: "INACTIVE", rewardAmount: 800 })
      .expect(200);
    expect(updateRes.body.status).toBe("INACTIVE");
    expect(updateRes.body.rewardAmount).toBe("800");

    const listRes = await request(app.getHttpServer())
      .get("/api/v1/admin/reward-rules")
      .set("Cookie", adminCookie)
      .expect(200);
    const found = listRes.body.find((r: { ruleCode: string }) => r.ruleCode === ruleCode);
    expect(found).toBeTruthy();
    expect(found.status).toBe("INACTIVE");
  });

  /**
   * 付与額の変更は、以降のすべての付与額を左右する会計上の重要な操作。
   * 管理画面から変更できるようにしたため (設定 > 付与ルール管理の「編集」)、
   * **誰がいつ何をいくらに変えたか**が追えることをここで担保する。
   */
  it("records who changed a reward rule's amount and limits, with before/after values", async () => {
    const server = app.getHttpServer();
    const ruleCode = `E2E_AUDIT_${generateId()}`;

    const created = await request(server)
      .post("/api/v1/admin/reward-rules")
      .set("Cookie", adminCookie)
      .send({
        ruleCode,
        ruleName: "監査ログ確認用",
        sourceService: "AIART",
        rewardAmount: 1000,
        displayName: "監査ログ確認用",
        perUserLimit: 1,
      })
      .expect(201);

    await request(server)
      .patch(`/api/v1/admin/reward-rules/${ruleCode}`)
      .set("Cookie", adminCookie)
      .send({ rewardAmount: 500, perUserLimit: null })
      .expect(200);

    const log = await prisma.auditLog.findFirst({
      where: { actionType: "REWARD_RULE_UPDATE", targetId: created.body.id },
      orderBy: { createdAt: "desc" },
    });

    expect(log).not.toBeNull();
    expect(log?.actorType).toBe("ADMIN");
    expect(log?.actorId).toBeTruthy();
    // 変更前後の両方が残っていないと「いくらから いくらに」変えたのかが追えない
    expect((log?.beforeData as Record<string, unknown>).rewardAmount).toBe("1000");
    expect((log?.afterData as Record<string, unknown>).rewardAmount).toBe("500");
    expect((log?.beforeData as Record<string, unknown>).perUserLimit).toBe(1);
    expect((log?.afterData as Record<string, unknown>).perUserLimit).toBeNull();
  });

  it("returns 404 when updating a rule that does not exist", async () => {
    await request(app.getHttpServer())
      .patch("/api/v1/admin/reward-rules/DOES_NOT_EXIST")
      .set("Cookie", adminCookie)
      .send({ status: "INACTIVE" })
      .expect(404);
  });
});
