import { Injectable } from "@nestjs/common";

/**
 * PR-W2: 純粋関数化したレスポンス組み立て (`service-balance-response.ts`) へ現在時刻を
 * 渡すための抽象。テストではClock実装を介さず、この`now()`が返す`Date`と同じ値を
 * 純粋関数へ直接渡すことで固定時刻を検証する (Nestの`overrideProvider`は使わない、
 * `WALLET_INTEGRATION_ANSWERS`等と同じくこのリポジトリの既存テスト方針に合わせるため)。
 */
export interface Clock {
  now(): Date;
}

/** TypeScriptのinterfaceはランタイムに消えるため、DI注入にはSymbolトークンを使う。 */
export const CLOCK = Symbol("CLOCK");

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
