-- 外部マーケットのカード画像をウォレット側へ取り込むための控え
-- (docs/collectible-images.md)。取得元URLを単位にしており、同じURLは同じ画像として
-- カードの種類・保有者をまたいで1件で足りる。
CREATE TYPE "CollectibleImageStatus" AS ENUM ('PENDING', 'STORED', 'FAILED');

CREATE TABLE "collectible_images" (
    "id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "status" "CollectibleImageStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT,
    "content_type" TEXT,
    "byte_size" INTEGER,
    "sha256" TEXT,
    "resolved_url" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "stored_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collectible_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collectible_images_source_url_key" ON "collectible_images"("source_url");
-- 再取得の対象を拾うための索引 (status で絞り、古い試行から順に処理する)。
CREATE INDEX "collectible_images_status_last_attempt_at_idx" ON "collectible_images"("status", "last_attempt_at");
CREATE INDEX "collectible_images_sha256_idx" ON "collectible_images"("sha256");
