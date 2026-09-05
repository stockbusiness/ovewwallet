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
