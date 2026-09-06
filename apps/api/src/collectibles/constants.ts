/**
 * PR#2最終修正指示書 P0-1/P0-4。entitlement.granted/revokedの送信元制限・
 * metadata.entitlement_type検証で共有する定数。common-events配下のハンドラと
 * collectibles配下のUseCaseの双方から参照するため、両者が依存できるこの層に置く。
 *
 * 千ノ国NFTマーケット契約v2指示書15章: 正式値は`sennokuni-nft-market`。
 * `sengoku-market`は旧接続が必要な間だけのLegacy値として引き続き許可する
 * (Legacy廃止時期は別途決定、単一文字列のハードコードを避けるためSetにする)。
 */
export const SENGOKU_MARKET_SOURCE_SYSTEM_KEY = "sengoku-market";
export const SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY = "sennokuni-nft-market";

/**
 * 会員券を扱う千ノ国マーケット (旧・戦国マーケット) の正式 source_system_key
 * (5システム決定1)。上のNFTアートマーケットとは**別のマーケット**で、クローズドな
 * 環境で会員券のNFTを売る。
 */
export const SENNOKUNI_COMMERCE_SOURCE_SYSTEM_KEY = "sengoku-commerce";

/**
 * `entitlement.granted`/`entitlement.revoked`を受理する source_system_key と、それが
 * 指す**論理Market**の対応。
 *
 * `sennokuni-nft-market` と `sengoku-market` は**同一マーケット(千ノ国NFTマーケット)の
 * 新旧表記**なので、同じ論理Marketへ寄せる。片方で付与してもう片方で取消しても一致と
 * して扱えるようにするため。
 *
 * 論理Marketは**保有権の同一性の単位**でもある。`collectible_holdings` /
 * `collectible_entitlement_tombstones` の一意制約は `(logical_market, entitlement_id)`
 * の複合なので、別々のマーケットが偶然同じ `entitlement_id` を採番しても衝突しない
 * (docs/collectible-multi-market.md)。
 *
 * **2つ目のマーケットを足すときは、論理Marketも別の値にすること。** 同じ値にすると
 * ID空間を共有する前提になり、他方のカードを上書きしうる。
 */
export const ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES: Record<string, string> = {
  [SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY]: "nft-art-market",
  [SENGOKU_MARKET_SOURCE_SYSTEM_KEY]: "nft-art-market",
  // 会員券の千ノ国マーケット。**論理Marketを別の値にしている。** 同じにすると
  // ID空間を共有する前提になり、両者が同じ entitlement_id を採番したときに
  // 他方の保有権を上書きしうる。
  [SENNOKUNI_COMMERCE_SOURCE_SYSTEM_KEY]: "membership-market",
};

/**
 * 受理する source_system_key から論理Marketを引く。未知なら `null`
 * (呼び出し元が拒否する)。
 */
export function logicalMarketFor(sourceSystemKey: string): string | null {
  return ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES[sourceSystemKey] ?? null;
}

export const NFT_MARKET_SOURCE_SYSTEM_KEYS = new Set(
  Object.keys(ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES),
);

/** PR-W3-a: entitlement.revoked/tombstoneのreason_codeとして表示マッピングを持つ既知語彙。
 * 未知の値でも受理し取消処理は継続するが、監査ログへ別途記録する
 * (`RevokeCollectibleUseCase`参照)。 */
export const KNOWN_COLLECTIBLE_REVOKE_REASON_CODES = new Set(["full_refund"]);

export const DIGITAL_COLLECTIBLE_ENTITLEMENT_TYPE = "digital_collectible";

/** 会員券。カードと同じ保有権の仕組みに乗せ、種類だけを分けて持つ。 */
export const MEMBERSHIP_PASS_ENTITLEMENT_TYPE = "membership_pass";

/**
 * 正規化済みの entitlement_type → 保有権の種類。
 *
 * 会員券の種別値はウォレット側で決めてよい、と先方から回答を得ている
 * (2026-09-06)。`MEMBERSHIP_PASS` を正式値とする。
 */
export const ENTITLEMENT_TYPE_TO_HOLDING_KIND: Record<
  string,
  "DIGITAL_COLLECTIBLE" | "MEMBERSHIP_PASS"
> = {
  [DIGITAL_COLLECTIBLE_ENTITLEMENT_TYPE]: "DIGITAL_COLLECTIBLE",
  [MEMBERSHIP_PASS_ENTITLEMENT_TYPE]: "MEMBERSHIP_PASS",
};

/**
 * マーケットごとに受け付ける保有権の種類。**アートマーケットから会員券は受け取らない。**
 * 送信元を取り違えた設定ミスを、こちら側で気づけるようにするため。
 */
export const LOGICAL_MARKET_ALLOWED_KINDS: Record<string, ReadonlySet<string>> = {
  "nft-art-market": new Set([DIGITAL_COLLECTIBLE_ENTITLEMENT_TYPE]),
  "membership-market": new Set([MEMBERSHIP_PASS_ENTITLEMENT_TYPE]),
};

/**
 * 契約v2指示書23章。`entitlement.granted`/`entitlement.revoked`はat-least-once・順序保証
 * なしで届くため、同じ論理Market・同じentitlement_idの処理(Holding作成 / Tombstone作成)が同時に走ると
 * 「revoke先行→tombstone」と「grant」が競合しうる。`collectible_holdings`への行ロック
 * (`FOR UPDATE`)は対象行が存在しない間は何も守らないため、PostgreSQL advisory lockで
 * entitlement_id単位に直列化する (PR#2最終修正 P1-1のasset_code単位ロックと同じ手法)。
 */
export function entitlementAdvisoryLockKey(
  logicalMarket: string,
  entitlementId: string,
): string {
  // 論理Marketを含める。別マーケットが同じentitlement_idを採番したとき、無関係な
  // 処理同士が直列化されてしまうのを避けるため。
  return `collectible_entitlement:${logicalMarket}:${entitlementId}`;
}
