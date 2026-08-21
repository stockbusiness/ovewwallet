import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  NFT_MARKET_WALLET_TARGET_SITE_KEY,
  type CommonEventBody,
} from "@ove/shared-types";

/** PR-W3-a: 1.1の必須項目検証(packages/shared-types)と同じ値を参照するよう共通化した。 */
export { NFT_MARKET_WALLET_TARGET_SITE_KEY };

const NFT_MARKET_ENTITLEMENT_TYPE_ALIASES: Record<string, string> = {
  DIGITAL_COLLECTIBLE: "digital_collectible",
  digital_collectible: "digital_collectible",
};

/** 指示書17章「対象」5フィールド。 */
type NormalizedEnvelopeField =
  | "entitlement_id"
  | "order_id"
  | "order_item_id"
  | "product_code"
  | "common_user_id";

export type NormalizedEntitlementEnvelope = Record<
  NormalizedEnvelopeField,
  string | null | undefined
>;

/**
 * 千ノ国NFTマーケット契約v2指示書17章。1フィールド分の`data.field`とlegacy
 * トップレベルfieldを突き合わせる。優先順位はdata優先、両方あって値が異なれば
 * 推測で混ぜず拒否する (400 CONTRACT_CONFLICT)。
 */
function normalizeField(
  data: Record<string, unknown> | undefined,
  legacyValue: unknown,
  fieldName: NormalizedEnvelopeField,
): string | null | undefined {
  const dataValue = data?.[fieldName];
  const hasData = dataValue !== undefined && dataValue !== null;
  const hasLegacy = legacyValue !== undefined && legacyValue !== null;

  if (hasData && hasLegacy && dataValue !== legacyValue) {
    throw new BadRequestException(
      `CONTRACT_CONFLICT: data.${fieldName} ("${String(dataValue)}") does not match legacy top-level ${fieldName} ("${String(legacyValue)}")`,
    );
  }
  if (hasData) return dataValue as string;
  return legacyValue as string | null | undefined;
}

/**
 * 千ノ国NFTマーケット契約v2指示書16〜17章。新`data{}` Envelopeと旧フラット契約の
 * 併存期間中、entitlement.granted/revokedが参照する業務項目を1箇所で正規化する。
 * `common_user_id`がdata内に来ない正式契約の場合も、この関数は単にdata側が
 * undefinedとなりlegacy(トップレベル)へ自然にフォールバックするため、
 * 特別扱いは不要 (指示書17章の注記どおり)。
 */
export function normalizeEntitlementEnvelope(
  body: CommonEventBody,
): NormalizedEntitlementEnvelope {
  const data =
    (body.data as Record<string, unknown> | null | undefined) ?? undefined;
  return {
    entitlement_id: normalizeField(data, body.entitlement_id, "entitlement_id"),
    order_id: normalizeField(data, body.order_id, "order_id"),
    order_item_id: normalizeField(data, body.order_item_id, "order_item_id"),
    product_code: normalizeField(data, body.product_code, "product_code"),
    common_user_id: normalizeField(data, body.common_user_id, "common_user_id"),
  };
}

/**
 * 指示書18章。新Market`DIGITAL_COLLECTIBLE`と旧Wallet`digital_collectible`の両方を
 * 受理し、内部正式値`digital_collectible`へ正規化する。未知のtypeは`null`を返し、
 * 呼び出し元が拒否する (将来の未知typeを勝手にlowercaseして受理しない)。
 */
export function normalizeEntitlementType(rawType: unknown): string | null {
  if (typeof rawType !== "string") return null;
  return NFT_MARKET_ENTITLEMENT_TYPE_ALIASES[rawType] ?? null;
}

/**
 * 指示書19章。`target_site_key`が付与されている場合のみこのWallet宛てかを検証する
 * (省略時は旧契約のイベントと解釈し検証をスキップする)。不一致は別サービス宛て
 * イベントの誤配送の可能性が高いため処理せず拒否する。
 */
export function assertTargetSiteKeyMatchesWallet(body: CommonEventBody): void {
  const targetSiteKey = body.target_site_key;
  if (targetSiteKey && targetSiteKey !== NFT_MARKET_WALLET_TARGET_SITE_KEY) {
    throw new ForbiddenException(
      `target_site_key "${targetSiteKey}" does not match this wallet ("${NFT_MARKET_WALLET_TARGET_SITE_KEY}")`,
    );
  }
}

/**
 * PR-W3-a: `occurred_at`をDateへ変換する。無効な値はInvalid Dateや現在時刻へ暗黙に
 * フォールバックせず、400として明示的に拒否する
 * (`entitlement-granted.handler.ts`の`new Date(body.occurred_at)`直書きに同じ問題があったため
 * ここで共通化し、grant/revoke両方から使う)。
 */
export function parseRequiredOccurredAt(
  rawValue: string,
  eventTypeLabel: string,
): Date {
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `${eventTypeLabel}: occurred_at ("${rawValue}") is not a valid date`,
    );
  }
  return parsed;
}
