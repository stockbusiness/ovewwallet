-- CreateTable
CREATE TABLE "collectible_entitlement_tombstones" (
    "id" TEXT NOT NULL,
    "entitlement_id" TEXT NOT NULL,
    "source_system_key" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collectible_entitlement_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collectible_entitlement_tombstones_entitlement_id_key" ON "collectible_entitlement_tombstones"("entitlement_id");
