-- AlterTable
ALTER TABLE "collectible_entitlement_tombstones" ADD COLUMN     "correlation_id" TEXT,
ADD COLUMN     "occurred_at" TIMESTAMP(3),
ADD COLUMN     "reason_code" TEXT;

-- AlterTable
ALTER TABLE "collectible_holdings" ADD COLUMN     "revoke_reason_code" TEXT,
ADD COLUMN     "revoked_by_event_id" TEXT,
ADD COLUMN     "revoked_by_source_system_key" TEXT,
ADD COLUMN     "revoked_correlation_id" TEXT,
ADD COLUMN     "revoked_occurred_at" TIMESTAMP(3);
