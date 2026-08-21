import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import {
  createTestCommonEventSigningKey,
  commonEventSignedHeaders,
  type TestCommonEventSigningKey,
} from "./test-helpers";

const ENDPOINT = "/api/integrations/events";

/**
 * PR-W3-a-1 V4承認 §6「旧event_id単独UNIQUE制約下での互換テスト」。
 * `InboundEvent.eventId`のUNIQUE制約はPR-W3-a-2で`source_system_key + event_id`へ
 * 複合化する予定だが、本PRの時点ではまだ単独UNIQUEのまま
 * (`packages/database/prisma/schema.prisma`の`InboundEvent.eventId`参照)。
 *
 * アプリ側の検索は`InboundEventRepository#findBySourceSystemKeyAndEventId`
 * (`findFirst`ベース) へ切り替え済みで、単独UNIQUE・複合UNIQUEのどちらの
 * DB制約下でも正しく動くことを狙っている。ここでは「まだ単独UNIQUEのまま」の
 * 現行DBに対して、(1) source_system_key単位の冪等性が正しく機能すること、
 * (2) 異なるsource_system_keyが同じevent_id値を独立に初回送信した場合に
 * 互いへ影響しないこと、(3) 旧DB制約により異なるsource_system_keyが同じ
 * event_id値でDB衝突(P2002)した過渡期特有のケースで、500ではなく
 * 409へ落ちることを確認する。
 */
describe("InboundEvent: source_system_key単位の冪等性 (旧event_id単独UNIQUE制約との互換)", () => {
  let app: INestApplication;
  let sourceA: TestCommonEventSigningKey;
  let sourceB: TestCommonEventSigningKey;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    sourceA = await createTestCommonEventSigningKey("inbound-idem-source-a");
    sourceB = await createTestCommonEventSigningKey("inbound-idem-source-b");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.ENABLE_COMMON_EVENT_INBOX = "true";
  });

  function baseBody(
    sourceSystemKey: string,
    overrides: Partial<Record<string, unknown>> = {},
  ) {
    return {
      event_id: `evt_${generateId()}`,
      event_type: "common_user.resolved",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: sourceSystemKey,
      common_user_id: `cu_${generateId()}`,
      source_user_id: generateId(),
      ...overrides,
    };
  }

  it("同一source_system_keyからの同一event_id再送は処理結果をキャッシュして返す (冪等)", async () => {
    const body = baseBody("inbound-idem-source-a");
    const headers1 = commonEventSignedHeaders(sourceA, body);
    const first = await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headers1)
      .send(body)
      .expect(201);
    expect(first.body.cached).toBe(false);

    const headers2 = commonEventSignedHeaders(sourceA, body);
    const second = await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headers2)
      .send(body)
      .expect(201);
    expect(second.body.cached).toBe(true);
    expect(second.body.result).toEqual(first.body.result);

    const rows = await prisma.inboundEvent.findMany({
      where: { eventId: body.event_id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceSystemKey).toBe("inbound-idem-source-a");
  });

  it("同一source_system_key・同一event_idで本文が異なる再送は409になる", async () => {
    const body = baseBody("inbound-idem-source-a");
    const headers = commonEventSignedHeaders(sourceA, body);
    await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headers)
      .send(body)
      .expect(201);

    const tampered = { ...body, common_user_id: `cu_${generateId()}` };
    const tamperedHeaders = commonEventSignedHeaders(sourceA, tampered);
    await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(tamperedHeaders)
      .send(tampered)
      .expect(409);
  });

  it("異なるsource_system_keyが偶然同じevent_id値を初回送信した場合、互いに独立して処理される", async () => {
    const sharedEventId = `evt_${generateId()}`;
    const bodyA = baseBody("inbound-idem-source-a", {
      event_id: sharedEventId,
    });
    const headersA = commonEventSignedHeaders(sourceA, bodyA);
    const resA = await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headersA)
      .send(bodyA)
      .expect(201);
    expect(resA.body.cached).toBe(false);

    // 旧DB(event_id単独UNIQUE)では、2件目の直接createが同じevent_id値で衝突するため、
    // ここは意図的にP2002 → 競合再読込 → ハッシュ不一致の409経路を通ることを許容する。
    // アプリの意図としては別イベントとして扱いたいが、DB制約がPR-W3-a-2で複合化される
    // までは区別できないため、少なくとも500にならず409として安全に扱われることを検証する。
    const bodyB = baseBody("inbound-idem-source-b", {
      event_id: sharedEventId,
    });
    const headersB = commonEventSignedHeaders(sourceB, bodyB);
    const resB = await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headersB)
      .send(bodyB);
    expect([201, 409]).toContain(resB.status);

    if (resB.status === 201) {
      const rows = await prisma.inboundEvent.findMany({
        where: { eventId: sharedEventId },
      });
      expect(rows).toHaveLength(2);
      const rowA = rows.find(
        (r) => r.sourceSystemKey === "inbound-idem-source-a",
      );
      const rowB = rows.find(
        (r) => r.sourceSystemKey === "inbound-idem-source-b",
      );
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();
    }
  });

  it("旧event_id単独UNIQUE制約下でP2002が起きても500ではなく409を返す (異なるsource_system_keyの衝突)", async () => {
    // beforeAllのapp起動を待たずDB直挿入で、sourceAが既にこのevent_idを使用済みの状態を
    // 確実に再現する (findBySourceSystemKeyAndEventIdOrThrowが直接テストできる唯一の経路は
    // InboundEventsService#createPendingRowのP2002キャッチブロック経由のため、HTTP経由で
    // 検証する)。
    const collidingEventId = `evt_${generateId()}`;
    await prisma.inboundEvent.create({
      data: {
        id: generateId(),
        eventId: collidingEventId,
        eventType: "common_user.resolved",
        eventVersion: "1.0",
        sourceSystemKey: "inbound-idem-source-a",
        payload: { pre_seeded: true } as never,
        payloadHash: "pre-seeded-hash",
        status: "SUCCEEDED",
      },
    });

    const bodyB = baseBody("inbound-idem-source-b", {
      event_id: collidingEventId,
    });
    const headersB = commonEventSignedHeaders(sourceB, bodyB);

    // 旧DB制約により、sourceB用のPENDING行作成がeventId単独UNIQUEに衝突しP2002が起きる。
    // source_system_key単位の再読込 (findBySourceSystemKeyAndEventId) はsourceB自身の行を
    // 見つけられない(衝突している行はsourceAのものであるため)ので、500ではなく
    // InboundEventCrossSourceConflictError (409) へ落ちることを期待する。
    const res = await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headersB)
      .send(bodyB);
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);

    const rows = await prisma.inboundEvent.findMany({
      where: { eventId: collidingEventId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceSystemKey).toBe("inbound-idem-source-a");
  });
});
