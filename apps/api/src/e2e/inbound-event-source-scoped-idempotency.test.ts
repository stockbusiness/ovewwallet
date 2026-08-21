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
 * PR-W3-a-2。`InboundEvent`の一意性を`event_id`単独UNIQUEから
 * `source_system_key + event_id`の複合UNIQUEへ切り替えた後の挙動を確認する
 * (`packages/database/prisma/migrations/20260821031135_inbound_event_composite_unique/`)。
 *
 * 確認する内容:
 *   1. 同一source_system_keyからの同一event_id再送は冪等にキャッシュされる
 *   2. 同一source_system_key・同一event_idで本文が異なる場合は409
 *   3/8. 異なるsource_system_keyが同じevent_id値を送っても、互いに完全に独立して
 *        成功する (PR-W3-a-1時点では旧DB制約により409に落ちることを許容していたが、
 *        本PRの複合UNIQUE化後は常に201で両方成功することを期待する、という
 *        意図的な期待値の変更)
 *   4. source_system_keyが異なる行を誤って取得しない
 *   5/6. 実際のDBオブジェクトとして新複合UNIQUE INDEXが存在し、旧単独UNIQUE INDEXが
 *        存在しないこと (pg_indexesを直接確認する)
 *   9. entitlement以外の既存イベント (common_user.resolved) も従来通り正常処理される
 *
 * `InboundEventCrossSourceConflictError`自体の回帰確認 (必須テスト10) は、複合UNIQUE化後は
 * 実DBでP2002を誘発する経路が構造的に無くなったため、`inbound-events-cross-source-conflict.test.ts`
 * でrepositoryをモックしたユニットテストとして別途検証する。
 */
describe("InboundEvent: source_system_key + event_id 複合UNIQUE化後の挙動", () => {
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
      // 「entitlement以外の既存イベントも正常処理される」ことの確認を兼ね、
      // 意図的にentitlement系ではないevent_typeを使う。
      event_type: "common_user.resolved",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: sourceSystemKey,
      common_user_id: `cu_${generateId()}`,
      source_user_id: generateId(),
      ...overrides,
    };
  }

  it("DBの実オブジェクト: 新複合UNIQUE INDEXが存在し、旧単独UNIQUE INDEXが存在しない", async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ indexname: string; indexdef: string }>
    >`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'inbound_events'
      ORDER BY indexname
    `;
    const names = indexes.map((i) => i.indexname);
    expect(names).toContain("inbound_events_source_system_key_event_id_key");
    expect(names).not.toContain("inbound_events_event_id_key");

    const composite = indexes.find(
      (i) => i.indexname === "inbound_events_source_system_key_event_id_key",
    );
    expect(composite?.indexdef).toContain("UNIQUE INDEX");
    expect(composite?.indexdef).toContain("(source_system_key, event_id)");

    // pg_constraintには (PKを除き) 何も追加されていないこと (UNIQUE INDEXであってUNIQUE
    // CONSTRAINTではない、という実機確認結果をこのテストでも固定する)。
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conrelid = 'public.inbound_events'::regclass
    `;
    expect(constraints.map((c) => c.conname)).toEqual(["inbound_events_pkey"]);
  });

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

  it("同一source_system_key・同一event_idで本文が異なる再送は409になり、既存結果を変更しない", async () => {
    const body = baseBody("inbound-idem-source-a");
    const headers = commonEventSignedHeaders(sourceA, body);
    const first = await request(app.getHttpServer())
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

    const row = await prisma.inboundEvent.findFirstOrThrow({
      where: {
        sourceSystemKey: "inbound-idem-source-a",
        eventId: body.event_id,
      },
    });
    expect(row.resultPayload).toEqual(first.body.result);
  });

  it("異なるsource_system_keyが同じevent_id値を送っても、互いに完全に独立して成功する (2件作成)", async () => {
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

    const bodyB = baseBody("inbound-idem-source-b", {
      event_id: sharedEventId,
    });
    const headersB = commonEventSignedHeaders(sourceB, bodyB);
    const resB = await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headersB)
      .send(bodyB)
      .expect(201);
    expect(resB.body.cached).toBe(false);

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
  });

  it("source_system_keyが異なる行を誤って取得しない (sourceAの既存行がsourceBの新規送信を冪等キャッシュ扱いしない)", async () => {
    const sharedEventId = `evt_${generateId()}`;
    const bodyA = baseBody("inbound-idem-source-a", {
      event_id: sharedEventId,
      common_user_id: `cu_${generateId()}`,
    });
    const headersA = commonEventSignedHeaders(sourceA, bodyA);
    await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headersA)
      .send(bodyA)
      .expect(201);

    // sourceBは同じevent_idだが全く異なる本文で送る。sourceAの行に引きずられて
    // ハッシュ不一致409になってはならない (source_system_key単位で独立しているため)。
    const bodyB = baseBody("inbound-idem-source-b", {
      event_id: sharedEventId,
      common_user_id: `cu_${generateId()}`,
    });
    const headersB = commonEventSignedHeaders(sourceB, bodyB);
    const resB = await request(app.getHttpServer())
      .post(ENDPOINT)
      .set(headersB)
      .send(bodyB)
      .expect(201);
    expect(resB.body.cached).toBe(false);
  });
});
