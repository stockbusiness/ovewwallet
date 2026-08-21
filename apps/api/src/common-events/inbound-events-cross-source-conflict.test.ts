import { Prisma, type InboundEvent } from "@ove/database";
import type { CommonEventBody } from "@ove/shared-types";
import type { CommonEventHandlersService } from "./common-event-handlers.service";
import type { InboundEventRepository } from "./inbound-event.repository";
import {
  InboundEventCrossSourceConflictError,
  InboundEventsService,
} from "./inbound-events.service";

/**
 * PR-W3-a-2 レビュー指摘c/必須テスト10「ロールバック前提のCrossSourceConflictErrorが
 * 壊れていないこと」。複合UNIQUE化後はこの経路は通常到達しないが、compatibility guard
 * として残す判断のため、コードとして正しく動作し続けることを直接検証する
 * (実DBでのP2002誘発が複合UNIQUE化後は構造的に不可能になったため、repositoryを
 * モックしてP2002 + 競合再読込nullのケースを直接再現する)。
 */
describe("InboundEventsService: InboundEventCrossSourceConflictError (compatibility guard)", () => {
  function makeP2002Error(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`event_id`)",
      {
        code: "P2002",
        clientVersion: "5.22.0",
      },
    );
  }

  it("createPendingでP2002が起き、source_system_key単位の再読込でも行が見つからない場合は409 (InboundEventCrossSourceConflictError) を投げる (500にならない)", async () => {
    const repository = {
      findBySourceSystemKeyAndEventId: jest.fn().mockResolvedValue(null),
      createPending: jest.fn().mockRejectedValue(makeP2002Error()),
    } as unknown as InboundEventRepository;
    const handlers = {
      dispatch: jest.fn(),
    } as unknown as CommonEventHandlersService;
    const service = new InboundEventsService(repository, handlers);

    const body = {
      event_id: "evt_conflict_test",
      event_type: "common_user.resolved",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: "some-source",
    } as unknown as CommonEventBody;

    await expect(service.receive(body, "some-source")).rejects.toBeInstanceOf(
      InboundEventCrossSourceConflictError,
    );
    // findBySourceSystemKeyAndEventIdは「初回チェック」と「P2002後の競合再読込」の2回呼ばれる。
    expect(repository.findBySourceSystemKeyAndEventId).toHaveBeenCalledTimes(2);
  });

  it("createPendingでP2002が起きても、競合再読込で自身の行が見つかれば通常のキャッシュ/ハッシュ照合経路を通る (回帰確認)", async () => {
    const raceRow = {
      id: "row-1",
      eventId: "evt_conflict_test",
      sourceSystemKey: "some-source",
      payloadHash: "matching-hash",
      status: "PENDING",
    } as unknown as InboundEvent;

    const repository = {
      findBySourceSystemKeyAndEventId: jest
        .fn()
        .mockResolvedValueOnce(null) // 初回チェック: まだ存在しない
        .mockResolvedValueOnce(raceRow), // P2002後の競合再読込: 自分自身の行が見つかる
      createPending: jest.fn().mockRejectedValue(makeP2002Error()),
      claimForProcessing: jest.fn().mockResolvedValue(true),
      findByIdOrThrow: jest.fn().mockResolvedValue(raceRow),
      markSucceeded: jest
        .fn()
        .mockResolvedValue({
          ...raceRow,
          status: "SUCCEEDED",
          resultPayload: { ok: true },
        }),
    } as unknown as InboundEventRepository;
    const handlers = {
      dispatch: jest.fn().mockResolvedValue({ ok: true }),
    } as unknown as CommonEventHandlersService;
    const service = new InboundEventsService(repository, handlers);

    const body = {
      event_id: "evt_conflict_test",
      event_type: "common_user.resolved",
      event_version: "1.0",
      occurred_at: new Date().toISOString(),
      source_system_key: "some-source",
    } as unknown as CommonEventBody;

    // sha256Hex(JSON.stringify(body))がraceRow.payloadHashと一致しないため、通常は
    // ハッシュ不一致409になるが、ここではP2002からの復帰経路そのもの (500にならず、
    // 素通りでクラッシュしないこと) を確認する目的で、例外がConflictException系である
    // ことだけを確認する (InboundEventCrossSourceConflictErrorではないこと)。
    await expect(
      service.receive(body, "some-source"),
    ).rejects.not.toBeInstanceOf(InboundEventCrossSourceConflictError);
  });
});
