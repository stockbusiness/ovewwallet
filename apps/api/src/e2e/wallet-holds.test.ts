import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

/** ウォレットホーム画面「保留中残高の内訳」向け GET /api/v1/me/wallet/holds。 */
describe("保留中残高の内訳 (GET /api/v1/me/wallet/holds)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-holds-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Holds Admin",
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("進行中の保留のみ理由・金額付きで返し、解除済みは含めない", async () => {
    const server = app.getHttpServer();

    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const userCookie = userLogin.headers["set-cookie"] as unknown as string[];

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId: userLogin.body.ove_account_id } });

    await request(server)
      .post("/api/v1/admin/wallets/grant")
      .set("Cookie", adminCookie)
      .send({ walletId: wallet.id, amount: 5000, reason: "e2e grant" })
      .expect(201);

    const hold1 = await request(server)
      .post("/api/v1/admin/wallets/hold")
      .set("Cookie", adminCookie)
      .send({ walletId: wallet.id, amount: 1000, reason: "不正利用調査のため一時保留" })
      .expect(201);

    const hold2 = await request(server)
      .post("/api/v1/admin/wallets/hold")
      .set("Cookie", adminCookie)
      .send({ walletId: wallet.id, amount: 500, reason: "本人確認書類の確認待ち" })
      .expect(201);

    await request(server).post(`/api/v1/admin/holds/${hold2.body.id}/release`).set("Cookie", adminCookie).send({}).expect(201);

    const res = await request(server).get("/api/v1/me/wallet/holds").set("Cookie", userCookie).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: hold1.body.id, amount: "1000", reason: "不正利用調査のため一時保留" });
  });

  it("保留が無いウォレットでは空配列を返す", async () => {
    const server = app.getHttpServer();
    const idToken = `mock.${generateId()}`;
    const userLogin = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
    const userCookie = userLogin.headers["set-cookie"] as unknown as string[];

    const res = await request(server).get("/api/v1/me/wallet/holds").set("Cookie", userCookie).expect(200);
    expect(res.body).toEqual([]);
  });
});
