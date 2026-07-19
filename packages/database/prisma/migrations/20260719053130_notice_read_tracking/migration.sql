-- CreateEnum
CREATE TYPE "NoticeImportance" AS ENUM ('NORMAL', 'IMPORTANT');

-- AlterTable
ALTER TABLE "notices" ADD COLUMN     "importance" "NoticeImportance" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "notice_reads" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "ove_account_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notice_reads_ove_account_id_idx" ON "notice_reads"("ove_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "notice_reads_notice_id_ove_account_id_key" ON "notice_reads"("notice_id", "ove_account_id");

-- AddForeignKey
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_ove_account_id_fkey" FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
