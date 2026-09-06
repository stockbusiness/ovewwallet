import {
  entitlementAdvisoryLockKey,
  LOGICAL_MARKET_ALLOWED_KINDS,
  logicalMarketFor,
  NFT_MARKET_SOURCE_SYSTEM_KEYS,
  SENNOKUNI_COMMERCE_LEGACY_SOURCE_SYSTEM_KEY,
  SENNOKUNI_COMMERCE_SOURCE_SYSTEM_KEY,
  SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY,
} from "./constants";

/**
 * 保有権の同一性を論理Market単位にしたこと (docs/collectible-multi-market.md) の
 * 回帰テスト。
 */
describe("logicalMarketFor", () => {
  it("同一マーケットの2つの表記は同じ論理Marketへ寄る", () => {
    // 片方で付与しもう片方で取消しても一致として扱えるようにするため。
    // 会員券マーケットは、先方の既存値と文書上の正式値の2つを受け付ける。
    expect(logicalMarketFor(SENNOKUNI_COMMERCE_SOURCE_SYSTEM_KEY)).toBe(
      logicalMarketFor(SENNOKUNI_COMMERCE_LEGACY_SOURCE_SYSTEM_KEY),
    );
  });

  it("sengoku-market は会員券マーケットを指す (NFTアートではない)", () => {
    // 2026-09-06に帰属を移した。取り違えると、会員券がNFTアート側のID空間へ
    // 入り込む (docs/collectible-multi-market.md)。
    expect(logicalMarketFor(SENNOKUNI_COMMERCE_LEGACY_SOURCE_SYSTEM_KEY)).toBe("membership-market");
    expect(logicalMarketFor(SENNOKUNI_NFT_MARKET_SOURCE_SYSTEM_KEY)).toBe("nft-art-market");
  });

  it("受理しない送信元では null を返す", () => {
    // 会員券の千ノ国マーケットは別の論理Marketとして受け付ける (下のdescribe参照)。
    expect(logicalMarketFor("unknown-market")).toBeNull();
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

  it("同一マーケットの2つの表記では同じキーになる", () => {
    const a = logicalMarketFor(SENNOKUNI_COMMERCE_SOURCE_SYSTEM_KEY)!;
    const b = logicalMarketFor(SENNOKUNI_COMMERCE_LEGACY_SOURCE_SYSTEM_KEY)!;
    expect(entitlementAdvisoryLockKey(a, "ent_1")).toBe(entitlementAdvisoryLockKey(b, "ent_1"));
  });

  it("マーケット名とIDの区切りが曖昧にならない", () => {
    // 区切りを入れずに連結すると "ab"+"c" と "a"+"bc" が同じキーになる。
    expect(entitlementAdvisoryLockKey("ab", "c")).not.toBe(entitlementAdvisoryLockKey("a", "bc"));
  });
});

describe("会員券の千ノ国マーケット", () => {
  it("NFTアートマーケットとは別の論理Marketになる", () => {
    // 同じ値にするとID空間を共有する前提になり、両者が同じ entitlement_id を
    // 採番したときに他方の保有権を上書きしうる (docs/collectible-multi-market.md)。
    expect(logicalMarketFor("sengoku-commerce")).toBe("membership-market");
    expect(logicalMarketFor("sengoku-commerce")).not.toBe(
      logicalMarketFor("sennokuni-nft-market"),
    );
  });

  it("ロックキーがマーケットごとに分かれる", () => {
    expect(entitlementAdvisoryLockKey("membership-market", "ent-1")).not.toBe(
      entitlementAdvisoryLockKey("nft-art-market", "ent-1"),
    );
  });

  it("マーケットごとに受け付ける種類が分かれている", () => {
    // アートマーケットの鍵で会員券を送られたら、送信元かカード側の設定の
    // 取り違えなので受け付けない。
    expect(LOGICAL_MARKET_ALLOWED_KINDS["nft-art-market"]?.has("membership_pass")).toBe(false);
    expect(LOGICAL_MARKET_ALLOWED_KINDS["membership-market"]?.has("membership_pass")).toBe(true);
    expect(LOGICAL_MARKET_ALLOWED_KINDS["membership-market"]?.has("digital_collectible")).toBe(
      false,
    );
  });
});
