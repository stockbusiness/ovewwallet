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

  it("returns 404 when updating a rule that does not exist", async () => {
    await request(app.getHttpServer())
      .patch("/api/v1/admin/reward-rules/DOES_NOT_EXIST")
      .set("Cookie", adminCookie)
      .send({ status: "INACTIVE" })
      .expect(404);
  });
});
