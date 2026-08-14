import { generateId, prisma } from "@ove/database";
import { CollectibleEntitlementTombstonesRepository } from "./collectible-entitlement-tombstones.repository";

/** 千ノ国NFTマーケット契約v2指示書23〜24章の回帰テスト。 */
describe("CollectibleEntitlementTombstonesRepository", () => {
  const repo = new CollectibleEntitlementTombstonesRepository(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("finds no tombstone for an entitlement_id that was never revoked-before-grant", async () => {
    const found = await repo.findByEntitlementId(`ent_${generateId()}`);
    expect(found).toBeNull();
  });

  it("creates a tombstone and finds it by entitlement_id", async () => {
    const entitlementId = `ent_${generateId()}`;
    const created = await repo.create({
      id: generateId(),
      entitlementId,
      sourceSystemKey: "sennokuni-nft-market",
      eventId: `evt_${generateId()}`,
      reason: "refund",
      revokedAt: new Date(),
    });

    expect(created.entitlementId).toBe(entitlementId);

    const found = await repo.findByEntitlementId(entitlementId);
    expect(found?.id).toBe(created.id);
    expect(found?.sourceSystemKey).toBe("sennokuni-nft-market");
  });

  it("rejects a second tombstone for the same entitlement_id (UNIQUE制約)", async () => {
    const entitlementId = `ent_${generateId()}`;
    await repo.create({
      id: generateId(),
      entitlementId,
      sourceSystemKey: "sennokuni-nft-market",
      eventId: `evt_${generateId()}`,
      reason: "refund",
      revokedAt: new Date(),
    });

    await expect(
      repo.create({
        id: generateId(),
        entitlementId,
        sourceSystemKey: "sennokuni-nft-market",
        eventId: `evt_${generateId()}`,
        reason: "refund (retry)",
        revokedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
