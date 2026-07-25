/**
 * PR#2最終修正指示書 P0-1/P0-4。entitlement.granted/revokedの送信元制限・
 * metadata.entitlement_type検証で共有する定数。common-events配下のハンドラと
 * collectibles配下のUseCaseの双方から参照するため、両者が依存できるこの層に置く。
 */
export const SENGOKU_MARKET_SOURCE_SYSTEM_KEY = "sengoku-market";
export const DIGITAL_COLLECTIBLE_ENTITLEMENT_TYPE = "digital_collectible";
