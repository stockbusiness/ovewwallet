import {
  entitlementAdvisoryLockKey,
  logicalMarketFor,
  NFT_MARKET_SOURCE_SYSTEM_KEYS,
  SENGOKU_MARKET_SOURCE_SYSTEM_KEY,
  SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY,
} from "./constants";

/**
 * 保有権の同一性を論理Market単位にしたこと (docs/collectible-multi-market.md) の
 * 回帰テスト。
 */
describe("logicalMarketFor", () => {
  it("同一マーケットの新旧表記は同じ論理Marketへ寄る", () => {
    // 片方で付与しもう片方で取消しても一致として扱えるようにするため。
    expect(logicalMarketFor(SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY)).toBe(
      logicalMarketFor(SENGOKU_MARKET_SOURCE_SYSTEM_KEY),
    );
  });

  it("受理しない送信元では null を返す", () => {
    // 会員券の千ノ国マーケット (sengoku-commerce) はまだ受け口を開けていない。
    expect(logicalMarketFor("sengoku-commerce")).toBeNull();
    expect(logicalMarketFor("agency-system")).toBeNull();
    expect(logicalMarketFor("")).toBeNull();
  });

  it("受理する送信元はすべて論理Marketを持つ", () => {
    for (const key of NFT_MARKET_SOURCE_SYSTEM_KEYS) {
      expect(logicalMarketFor(key)).not.toBeNull();
    }
  });
});

describe("entitlementAdvisoryLockKey", () => {
  it("同じマーケット・同じentitlement_idなら同じキーになる", () => {
    // grant と revoke を同じキーで直列化するため。
    expect(entitlementAdvisoryLockKey("nft-art-market", "ent_1")).toBe(
      entitlementAdvisoryLockKey("nft-art-market", "ent_1"),
    );
  });

  it("マーケットが違えば別のキーになる", () => {
    // 別マーケットが同じentitlement_idを採番したとき、無関係な処理同士が
    // 直列化されてしまうのを避ける。
    expect(entitlementAdvisoryLockKey("nft-art-market", "ent_1")).not.toBe(
      entitlementAdvisoryLockKey("membership-market", "ent_1"),
    );
  });

  it("同一マーケットの新旧表記では同じキーになる", () => {
    const a = logicalMarketFor(SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY)!;
    const b = logicalMarketFor(SENGOKU_MARKET_SOURCE_SYSTEM_KEY)!;
    expect(entitlementAdvisoryLockKey(a, "ent_1")).toBe(entitlementAdvisoryLockKey(b, "ent_1"));
  });

  it("マーケット名とIDの区切りが曖昧にならない", () => {
    // 区切りを入れずに連結すると "ab"+"c" と "a"+"bc" が同じキーになる。
    expect(entitlementAdvisoryLockKey("ab", "c")).not.toBe(entitlementAdvisoryLockKey("a", "bc"));
  });
});
