-- AlterTable
ALTER TABLE "ove_accounts" ADD COLUMN     "common_user_id" TEXT,
ADD COLUMN     "common_user_linked_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ove_accounts_common_user_id_idx" ON "ove_accounts"("common_user_id");
