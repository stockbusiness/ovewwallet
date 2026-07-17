-- CreateEnum
CREATE TYPE "WalletReferralStatus" AS ENUM ('CAPTURED', 'PENDING', 'CONFIRMED', 'REJECTED', 'MANUALLY_CONFIRMED', 'CANCELLED', 'ERROR', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WalletReferralBenefitStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'REVOKED');

-- CreateTable
CREATE TABLE "wallet_referrals" (
    "id" TEXT NOT NULL,
    "wallet_user_id" TEXT,
    "common_user_id" TEXT,
    "session_token_hash" TEXT NOT NULL,
    "referral_token_encrypted" TEXT NOT NULL,
    "referral_token_hash" TEXT NOT NULL,
    "agency_id" TEXT,
    "agency_rank" TEXT,
    "status" "WalletReferralStatus" NOT NULL DEFAULT 'CAPTURED',
    "source" TEXT NOT NULL DEFAULT 'invite_url',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_referral_benefits" (
    "id" TEXT NOT NULL,
    "wallet_user_id" TEXT NOT NULL,
    "line_user_id_hash" TEXT,
    "referral_id" TEXT NOT NULL,
    "benefit_type" TEXT NOT NULL DEFAULT 'REFERRAL_SIGNUP_BONUS',
    "amount" BIGINT NOT NULL,
    "status" "WalletReferralBenefitStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "ledger_transaction_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_referral_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_referrals_session_token_hash_key" ON "wallet_referrals"("session_token_hash");

-- CreateIndex
CREATE INDEX "wallet_referrals_status_idx" ON "wallet_referrals"("status");

-- CreateIndex
CREATE INDEX "wallet_referrals_expires_at_idx" ON "wallet_referrals"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_referrals_wallet_user_id_key" ON "wallet_referrals"("wallet_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_referral_benefits_idempotency_key_key" ON "wallet_referral_benefits"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_referral_benefits_wallet_user_id_idx" ON "wallet_referral_benefits"("wallet_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_referral_benefits_benefit_type_wallet_user_id_key" ON "wallet_referral_benefits"("benefit_type", "wallet_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_referral_benefits_benefit_type_line_user_id_hash_key" ON "wallet_referral_benefits"("benefit_type", "line_user_id_hash");

-- AddForeignKey
ALTER TABLE "wallet_referrals" ADD CONSTRAINT "wallet_referrals_wallet_user_id_fkey" FOREIGN KEY ("wallet_user_id") REFERENCES "ove_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_referral_benefits" ADD CONSTRAINT "wallet_referral_benefits_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "wallet_referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
