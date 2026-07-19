-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'DAILY_LOGIN_BONUS';

-- CreateTable
CREATE TABLE "daily_bonus_claims" (
    "id" TEXT NOT NULL,
    "ove_account_id" TEXT NOT NULL,
    "claimed_date" DATE NOT NULL,
    "streak_count" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_bonus_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_bonus_claims_transaction_id_key" ON "daily_bonus_claims"("transaction_id");

-- CreateIndex
CREATE INDEX "daily_bonus_claims_ove_account_id_claimed_date_idx" ON "daily_bonus_claims"("ove_account_id", "claimed_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_bonus_claims_ove_account_id_claimed_date_key" ON "daily_bonus_claims"("ove_account_id", "claimed_date");

-- AddForeignKey
ALTER TABLE "daily_bonus_claims" ADD CONSTRAINT "daily_bonus_claims_ove_account_id_fkey" FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_bonus_claims" ADD CONSTRAINT "daily_bonus_claims_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ove_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
