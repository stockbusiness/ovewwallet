import { generateId, prisma } from "@ove/database";
import { CollectibleEntitlementTombstonesRepository } from "./collectible-entitlement-tombstones.repository";

const NFT_ART_MARKET = "nft-art-market";
const OTHER_MARKET = "membership-market";

/** 千ノ国NFTマーケット契約v2指示書23〜24章の回帰テスト。 */
describe("CollectibleEntitlementTombstonesRepository", () => {
  const repo = new CollectibleEntitlementTombstonesRepository(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("finds no tombstone for an entitlement_id that was never revoked-before-grant", async () => {
    const found = await repo.findByEntitlementId(NFT_ART_MARKET, `ent_${generateId()}`);
    expect(found).toBeNull();
  });

  it("creates a tombstone and finds it by entitlement_id", async () => {
    const entitlementId = `ent_${generateId()}`;
    const created = await repo.create({
      id: generateId(),
      entitlementId,
      sourceSystemKey: "sennokuni-nft-market",
      logicalMarket: NFT_ART_MARKET,
      eventId: `evt_${generateId()}`,
      reason: "refund",
      revokedAt: new Date(),
    });

    expect(created.entitlementId).toBe(entitlementId);

    const found = await repo.findByEntitlementId(NFT_ART_MARKET, entitlementId);
    expect(found?.id).toBe(created.id);
    expect(found?.sourceSystemKey).toBe("sennokuni-nft-market");
  });

  it("rejects a second tombstone for the same market and entitlement_id (UNIQUE制約)", async () => {
    const entitlementId = `ent_${generateId()}`;
    await repo.create({
      id: generateId(),
      entitlementId,
      sourceSystemKey: "sennokuni-nft-market",
      logicalMarket: NFT_ART_MARKET,
      eventId: `evt_${generateId()}`,
      reason: "refund",
      revokedAt: new Date(),
    });

    await expect(
      repo.create({
        id: generateId(),
        entitlementId,
        sourceSystemKey: "sennokuni-nft-market",
        logicalMarket: NFT_ART_MARKET,
        eventId: `evt_${generateId()}`,
        reason: "refund (retry)",
        revokedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("別マーケットが同じentitlement_idを採番しても衝突しない", async () => {
    // ここが複合キー化の目的。マーケットは互いのID採番を知らないので、
    // 同じ値が来ることは避けられない。
    const entitlementId = `ent_${generateId()}`;
    const base = {
      entitlementId,
      eventId: `evt_${generateId()}`,
      reason: "refund",
      revokedAt: new Date(),
    };

    const first = await repo.create({
      ...base,
      id: generateId(),
      sourceSystemKey: "sennokuni-nft-market",
      logicalMarket: NFT_ART_MARKET,
    });
    const second = await repo.create({
      ...base,
      id: generateId(),
      sourceSystemKey: "sengoku-commerce",
      logicalMarket: OTHER_MARKET,
    });

    expect(second.id).not.toBe(first.id);
  });

  it("マーケットが違えば互いの記録は見えない", async () => {
    const entitlementId = `ent_${generateId()}`;
    await repo.create({
      id: generateId(),
      entitlementId,
      sourceSystemKey: "sennokuni-nft-market",
      logicalMarket: NFT_ART_MARKET,
      eventId: `evt_${generateId()}`,
      reason: "refund",
      revokedAt: new Date(),
    });

    expect(await repo.findByEntitlementId(NFT_ART_MARKET, entitlementId)).not.toBeNull();
    expect(await repo.findByEntitlementId(OTHER_MARKET, entitlementId)).toBeNull();
  });
});
