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
export const NFT_MARKET_SOURCE_SYSTEM_KEYS = new Set([
  SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY,
  SENGOKU_MARKET_SOURCE_SYSTEM_KEY,
]);
export const DIGITAL_COLLECTIBLE_ENTITLEMENT_TYPE = "digital_collectible";
