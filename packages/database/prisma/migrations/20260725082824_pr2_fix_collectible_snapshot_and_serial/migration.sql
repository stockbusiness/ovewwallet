-- AlterTable
ALTER TABLE "collectible_holdings" ADD COLUMN     "description_snapshot" TEXT,
ADD COLUMN     "display_name_snapshot" TEXT,
ADD COLUMN     "image_hash_snapshot" TEXT,
ADD COLUMN     "image_url_snapshot" TEXT,
ADD COLUMN     "rarity_snapshot" TEXT,
ADD COLUMN     "serial_number" TEXT,
ADD COLUMN     "thumbnail_url_snapshot" TEXT;
