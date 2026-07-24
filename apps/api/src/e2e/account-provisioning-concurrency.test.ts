import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration, signedHeaders } from "./test-helpers";

/**
 * モジュール化後レビュー対応 P1-4: 同一identity/同一外部ユーザーへの同時初回登録
 * リクエストは、両方とも「未登録」判定を通過した後にaccount_identities/account_links
 * の一意制約で片方が失敗しうる (500応答になり、登録自体が失敗する不整合があった)。
 * `AccountRegistrationService`/`ExternalAccountProvisioningService`が一意制約違反を
 * 捕捉し、先に作成された側のアカウントを返すようになったことを検証する。
 */
describe("同時アカウント作成でも1ユーザーにつき1アカウント・500にならない (P1-4回帰)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("同一LINE idTokenでの同時ログインは、1アカウントだけ作成し全リクエストが201になる", async () => {
    const lineUserId = `e2e-concurrent-${generateId()}`;
    const idToken = `mock.${lineUserId}`;

    const concurrency = 5;
    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        request(app.getHttpServer()).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(201);
      expect(res.body.ove_account_id).toBeTruthy();
    }

    const accountIds = new Set(results.map((r) => r.body.ove_account_id as string));
    expect(accountIds.size).toBe(1);

    const identities = await prisma.accountIdentity.findMany({ where: { provider: "LINE", providerSubject: lineUserId } });
    expect(identities).toHaveLength(1);

    const wallets = await prisma.wallet.findMany({ where: { oveAccountId: [...accountIds][0] } });
    expect(wallets).toHaveLength(1);
  });

  it("同一(service_code, external_user_id)への同時初回付与は、1アカウントだけ作成する", async () => {
    const integration = await createTestServiceIntegration("AIART", { perRequestAmountLimit: 1_000_000 });
    const externalUserId = `e2e-concurrent-service-${generateId()}`;
    const GRANT_PATH = "/api/v1/rewards/grant";

    const concurrency = 5;
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => {
        const body = {
          service_code: "AIART",
          external_user_id: externalUserId,
          event_type: "ATTENDANCE",
          event_id: `EVT-${generateId()}`,
          amount: 100,
          transaction_type: "AIART_ATTENDANCE",
          display_name: "test",
          idempotency_key: `key-concurrent-${i}-${generateId()}`,
        };
        const headers = signedHeaders(integration, "POST", GRANT_PATH, body);
        return request(app.getHttpServer()).post(GRANT_PATH).set(headers).send(body);
      }),
    );

    for (const res of results) {
      expect(res.status).toBe(201);
      expect(res.body.ove_account_id).toBeTruthy();
    }

    const accountIds = new Set(results.map((r) => r.body.ove_account_id as string));
    expect(accountIds.size).toBe(1);

    const links = await prisma.accountLink.findMany({
      where: { serviceIntegrationId: integration.id, externalUserId },
    });
    expect(links).toHaveLength(1);

    const wallets = await prisma.wallet.findMany({ where: { oveAccountId: [...accountIds][0] } });
    expect(wallets).toHaveLength(1);
  });
});
