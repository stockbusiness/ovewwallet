import { Injectable } from "@nestjs/common";
import type { CommonEventHandler } from "./common-event-handler.interface";

/**
 * リファクタリング指示書 Phase 4 (§10): event_typeごとのハンドラを保持するレジストリ。
 * 新しいevent_typeへの対応は新規ハンドラを`register()`するだけでよく、既存ハンドラの
 * 変更を必要としない (受入条件「新イベント追加で既存Handlerを変更しない」)。
 *
 * `resolve()`は未登録のevent_typeに対して`undefined`を返す (例外を投げない)。契約6.2章の
 * 必須イベントのうちウォレットが反応しないもの (order系・payment系・entitlement系等) は
 * 意図的に未登録のままにするため、呼び出し元 (`CommonEventHandlersService`) が
 * 「記録のみ・200成功」という明示的なフォールバックを行う
 * (受入条件「未対応イベント挙動を明示」)。
 */
@Injectable()
export class CommonEventHandlerRegistry {
  private readonly handlers = new Map<string, CommonEventHandler>();

  /** 同一event_typeの二重登録はプログラミングミスとして起動時に即座に失敗させる。 */
  register(handler: CommonEventHandler): void {
    if (this.handlers.has(handler.eventType)) {
      throw new Error(`duplicate CommonEventHandler registration for event_type "${handler.eventType}"`);
    }
    this.handlers.set(handler.eventType, handler);
  }

  resolve(eventType: string): CommonEventHandler | undefined {
    return this.handlers.get(eventType);
  }
}
