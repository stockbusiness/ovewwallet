-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'EXPIRATION';

-- AlterTable
ALTER TABLE "reward_rules" ADD COLUMN     "expiry_days" INTEGER;

-- CreateTable
CREATE TABLE "ove_credit_lots" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "remaining_amount" BIGINT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "expired_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ove_credit_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ove_credit_lots_transaction_id_key" ON "ove_credit_lots"("transaction_id");

-- CreateIndex
CREATE INDEX "ove_credit_lots_wallet_id_expires_at_idx" ON "ove_credit_lots"("wallet_id", "expires_at");

-- AddForeignKey
ALTER TABLE "ove_credit_lots" ADD CONSTRAINT "ove_credit_lots_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ove_credit_lots" ADD CONSTRAINT "ove_credit_lots_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ove_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
