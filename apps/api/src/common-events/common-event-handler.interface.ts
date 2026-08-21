import type { CommonEventBody } from "@ove/shared-types";
import type { z } from "zod";

/**
 * リファクタリング指示書 Phase 4 (§10): 共通イベントハンドラの実行コンテキスト。
 * `authenticatedSourceSystemKey`は署名鍵から検証済みの送信元 (次期改修指示書P0-1、
 * 本文の自己申告`source_system_key`より常にこちらを信頼する)。
 */
export interface AuthenticatedEventContext {
  eventId: string;
  eventType: string;
  authenticatedSourceSystemKey: string;
}

/** 各ハンドラの戻り値。レスポンスにそのまま含めてよいプレーンオブジェクト。 */
export type CommonEventResult = Record<string, unknown>;

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 6.2章のイベントを1種類だけ処理するハンドラ。
 * `schema`は現状`CommonEventBodySchema`(コントローラで検証済みの汎用スキーマ)を
 * 指す共通の型としている。event_type別に必須/任意フィールドを厳密化した専用Schemaは
 * リファクタリング指示書 Phase 5 (event_type別DTO) で導入する。
 */
export interface CommonEventHandler<TPayload = CommonEventBody> {
  readonly eventType: string;
  readonly schema: z.ZodType<TPayload>;

  handle(
    context: AuthenticatedEventContext,
    payload: TPayload,
  ): Promise<CommonEventResult>;
}
