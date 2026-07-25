-- CreateEnum
CREATE TYPE "CollectibleAssetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CollectibleHoldingStatus" AS ENUM ('ACTIVE', 'REVOKED', 'MINT_READY', 'MINTING', 'ONCHAIN', 'TRANSFERRED', 'BURNED', 'ERROR');

-- CreateTable
CREATE TABLE "collectible_assets" (
    "id" TEXT NOT NULL,
    "asset_code" TEXT NOT NULL,
    "product_code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "image_hash" TEXT,
    "rarity" TEXT,
    "category" TEXT,
    "edition_size" INTEGER,
    "metadata" JSONB,
    "status" "CollectibleAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collectible_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collectible_holdings" (
    "id" TEXT NOT NULL,
    "ove_account_id" TEXT NOT NULL,
    "collectible_asset_id" TEXT NOT NULL,
    "entitlement_id" TEXT NOT NULL,
    "source_system_key" TEXT NOT NULL,
    "order_id" TEXT,
    "order_item_id" TEXT,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "status" "CollectibleHoldingStatus" NOT NULL DEFAULT 'ACTIVE',
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "metadata" JSONB,
    "network" TEXT,
    "chain_id" TEXT,
    "contract_address" TEXT,
    "token_id" TEXT,
    "transaction_hash" TEXT,
    "owner_address" TEXT,
    "minted_at" TIMESTAMP(3),
    "metadata_uri" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collectible_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collectible_assets_asset_code_key" ON "collectible_assets"("asset_code");

-- CreateIndex
CREATE INDEX "collectible_assets_product_code_idx" ON "collectible_assets"("product_code");

-- CreateIndex
CREATE UNIQUE INDEX "collectible_holdings_entitlement_id_key" ON "collectible_holdings"("entitlement_id");

-- CreateIndex
CREATE INDEX "collectible_holdings_ove_account_id_status_idx" ON "collectible_holdings"("ove_account_id", "status");

-- CreateIndex
CREATE INDEX "collectible_holdings_order_id_idx" ON "collectible_holdings"("order_id");

-- CreateIndex
CREATE INDEX "collectible_holdings_order_item_id_idx" ON "collectible_holdings"("order_item_id");

-- CreateIndex
CREATE INDEX "collectible_holdings_contract_address_token_id_idx" ON "collectible_holdings"("contract_address", "token_id");

-- AddForeignKey
ALTER TABLE "collectible_holdings" ADD CONSTRAINT "collectible_holdings_ove_account_id_fkey" FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collectible_holdings" ADD CONSTRAINT "collectible_holdings_collectible_asset_id_fkey" FOREIGN KEY ("collectible_asset_id") REFERENCES "collectible_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
