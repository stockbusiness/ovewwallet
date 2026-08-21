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
 * PR-W3-a レビュー指摘4: `entitlement.granted`/`entitlement.revoked`を受理するsource_system_key
 * を、Setではなく「source_system_key → 論理Market ID」の明示的マッピングとして持つ。
 * `sennokuni-nft-market`と`sengoku-market`は**同一のNFT作品マーケットの新旧表記**であり、
 * 同じentitlement_id名前空間を共有する前提を置いている。この前提は以下の条件でのみ有効:
 *
 * - 両キーは同一事業者・同一ID採番基盤(戦国マーケット側`NftIssue.id`)を指す。他事業者・
 *   他Marketへ流用しない。
 * - レガシー`sengoku-market`の廃止時期は別途運用判断で決定する(現時点で自動廃止しない)。
 * - `sengoku-commerce`(戦国マーケットの正式source_system_key、5システム決定1)は
 *   このマッピングに含まれないため、entitlement.granted/revokedからは常に拒否される。
 * - 万が一、両キーが実際には別々のID採番基盤であると判明した場合は、この「同一論理Market」
 *   という前提を撤回し、下記のentitlement_id複合化(既知課題)が完了するまでどちらか一方の
 *   受信を停止すること。
 *
 * 【重要】2つ目の実在Market(戦国マーケット等)のsource_system_keyをこのマッピングへ
 * 追加するPRは、CollectibleHolding/CollectibleEntitlementTombstoneのentitlement_id一意制約を
 * source_system_key + entitlement_idへ複合化し、検索条件・advisory lockもsource境界化する
 * 別PRを先に完了させてから行うこと。下の起動時アサーションが、対応漏れのまま2つ目の
 * 論理Marketが追加された場合に検知する。
 */
export const ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES: Record<string, string> = {
  [SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY]: "nft-art-market",
  [SENGOKU_MARKET_SOURCE_SYSTEM_KEY]: "nft-art-market",
};

const distinctEntitlementLogicalMarkets = new Set(
  Object.values(ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES),
);
if (distinctEntitlementLogicalMarkets.size !== 1) {
  throw new Error(
    "ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES now maps to more than one logical market. " +
      "This requires the entitlement_id source_system_key composite-uniqueness migration " +
      "(see PR-W3-a known issue) to ship first. Do not add a second market here without it.",
  );
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
 * なしで届くため、同じentitlement_idの処理(Holding作成 / Tombstone作成)が同時に走ると
 * 「revoke先行→tombstone」と「grant」が競合しうる。`collectible_holdings`への行ロック
 * (`FOR UPDATE`)は対象行が存在しない間は何も守らないため、PostgreSQL advisory lockで
 * entitlement_id単位に直列化する (PR#2最終修正 P1-1のasset_code単位ロックと同じ手法)。
 */
export function entitlementAdvisoryLockKey(entitlementId: string): string {
  return `collectible_entitlement:${entitlementId}`;
}
