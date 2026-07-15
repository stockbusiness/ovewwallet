import "reflect-metadata";
import { prisma, generateId } from "@ove/database";

/**
 * 監査ログ (audit_logs) はアプリケーション層の禁止だけでなく、DBレベル (トリガー) でも
 * DELETE/UPDATEを拒否する (マイグレーション `add_audit_logs_immutability_trigger`)。
 * アプリがpostgresの特権ユーザーで接続していてもGRANT/REVOKEでは無意味なため、
 * BEFOREトリガーで例外を送出する方式を採用している。
 */
describe("audit_logs immutability (DBレベル)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects DELETE at the DB level even for the app's own connection", async () => {
    const id = generateId();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.auditLog.create({
          data: { id, actorType: "ADMIN", actionType: "TEST", targetType: "test", result: "SUCCESS" },
        });
        await tx.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE id = $1`, id);
      }),
    ).rejects.toThrow(/immutable/);

    // トランザクションがロールバックされ、INSERTごと取り消されていること
    const row = await prisma.auditLog.findUnique({ where: { id } });
    expect(row).toBeNull();
  });

  it("rejects UPDATE at the DB level even for the app's own connection", async () => {
    const id = generateId();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.auditLog.create({
          data: { id, actorType: "ADMIN", actionType: "TEST", targetType: "test", result: "SUCCESS" },
        });
        await tx.$executeRawUnsafe(`UPDATE "audit_logs" SET action_type = 'HACKED' WHERE id = $1`, id);
      }),
    ).rejects.toThrow(/immutable/);

    const row = await prisma.auditLog.findUnique({ where: { id } });
    expect(row).toBeNull();
  });

  it("still allows normal INSERT/SELECT (the only operations the app performs)", async () => {
    const id = generateId();
    await prisma.auditLog.create({
      data: { id, actorType: "ADMIN", actionType: "TEST", targetType: "test", result: "SUCCESS" },
    });
    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id } });
    expect(row.actionType).toBe("TEST");
  });
});
