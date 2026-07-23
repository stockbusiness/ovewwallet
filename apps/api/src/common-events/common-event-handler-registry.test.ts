import { CommonEventHandlerRegistry } from "./common-event-handler-registry";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "./common-event-handler.interface";

function fakeHandler(eventType: string): CommonEventHandler {
  return {
    eventType,
    schema: { parse: (v: unknown) => v } as CommonEventHandler["schema"],
    async handle(_context: AuthenticatedEventContext, _payload: unknown): Promise<CommonEventResult> {
      return { ok: true };
    },
  };
}

describe("CommonEventHandlerRegistry (指示書Phase 4 §10)", () => {
  it("登録したハンドラをevent_typeで解決できる", () => {
    const registry = new CommonEventHandlerRegistry();
    const handler = fakeHandler("reward.granted");
    registry.register(handler);

    expect(registry.resolve("reward.granted")).toBe(handler);
  });

  it("未登録のevent_typeにはundefinedを返す(例外を投げない、受入条件「未対応イベント挙動を明示」)", () => {
    const registry = new CommonEventHandlerRegistry();
    expect(registry.resolve("order.created")).toBeUndefined();
  });

  it("同一event_typeの二重登録は起動時エラーになる(受入条件)", () => {
    const registry = new CommonEventHandlerRegistry();
    registry.register(fakeHandler("reward.granted"));

    expect(() => registry.register(fakeHandler("reward.granted"))).toThrow(
      /duplicate CommonEventHandler registration for event_type "reward\.granted"/,
    );
  });
});
