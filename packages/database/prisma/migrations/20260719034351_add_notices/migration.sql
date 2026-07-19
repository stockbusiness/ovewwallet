-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('PUBLISHED', 'DRAFT', 'ARCHIVED');

-- CreateTable
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NoticeStatus" NOT NULL DEFAULT 'PUBLISHED',
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notices_status_published_at_idx" ON "notices"("status", "published_at");
