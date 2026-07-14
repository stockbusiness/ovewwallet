-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'REVIEWING', 'LOCKED', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "IdentityType" AS ENUM ('LINE', 'EMAIL', 'PHONE', 'PASSKEY', 'GOOGLE', 'APPLE', 'BLOCKCHAIN_WALLET');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ServiceCode" AS ENUM ('SENGOKU_PASSPORT', 'AIART', 'SENGOKU_GACHA', 'SENGOKU_EC', 'NFT_MARKET', 'SENGOKU_METAVERSE', 'EVENT_SYSTEM');

-- CreateEnum
CREATE TYPE "ServiceIntegrationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AccountLinkStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'LOCKED', 'REVIEWING', 'MIGRATING', 'MIGRATED', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'HELD', 'FAILED', 'REVERSED', 'MIGRATING', 'MIGRATED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('REGISTRATION_BONUS', 'AIART_ATTENDANCE', 'EVENT_REWARD', 'CAMPAIGN_REWARD', 'REFERRAL_REWARD', 'PURCHASE_REWARD', 'GACHA_REWARD', 'ADMIN_GRANT', 'ADMIN_DEDUCTION', 'OPENING_BALANCE', 'GACHA_TICKET_EXCHANGE', 'COUPON_EXCHANGE', 'ITEM_EXCHANGE', 'HOLD', 'RELEASE', 'REVERSAL', 'RECOVERY', 'ACCOUNT_MERGE_IN', 'ACCOUNT_MERGE_OUT', 'BLOCKCHAIN_MIGRATION', 'MIGRATION_REVERSAL');

-- CreateEnum
CREATE TYPE "CreatedByType" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'EXTERNAL_SERVICE');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "RewardRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SCHEDULED', 'ENDED');

-- CreateEnum
CREATE TYPE "WalletHoldStatus" AS ENUM ('HELD', 'RELEASED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'OVE_OPERATOR', 'INTEGRATION_ADMIN', 'EVENT_OPERATOR', 'AUDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "AdminUserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalRequestType" AS ENUM ('HIGH_VALUE_GRANT', 'HIGH_VALUE_DEDUCTION', 'ACCOUNT_MERGE', 'EXTERNAL_WALLET_CHANGE', 'BLOCKCHAIN_MIGRATION', 'SERVICE_LIMIT_CHANGE');

-- CreateEnum
CREATE TYPE "BlockchainMigrationStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BulkGrantBatchStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'EXECUTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MigrationBatchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "code_counters" (
    "id" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "code_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ove_accounts" (
    "id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "display_name" TEXT,
    "primary_email" TEXT,
    "primary_phone" TEXT,
    "verification_level" INTEGER NOT NULL DEFAULT 0,
    "merged_into_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "ove_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_identities" (
    "id" TEXT NOT NULL,
    "ove_account_id" TEXT NOT NULL,
    "identity_type" "IdentityType" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "verified_at" TIMESTAMP(3),
    "status" "IdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_integrations" (
    "id" TEXT NOT NULL,
    "service_code" "ServiceCode" NOT NULL,
    "service_name" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "signing_secret_hash" TEXT NOT NULL,
    "allowed_ips" TEXT[],
    "daily_amount_limit" BIGINT NOT NULL,
    "per_request_amount_limit" BIGINT NOT NULL,
    "status" "ServiceIntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_accessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_links" (
    "id" TEXT NOT NULL,
    "ove_account_id" TEXT NOT NULL,
    "service_integration_id" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "status" "AccountLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "link_method" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "account_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "ove_account_id" TEXT NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "device_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "admin_code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "status" "AdminUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "display_name" TEXT NOT NULL,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "ove_account_id" TEXT NOT NULL,
    "wallet_code" TEXT NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "available_balance" BIGINT NOT NULL DEFAULT 0,
    "pending_balance" BIGINT NOT NULL DEFAULT 0,
    "held_balance" BIGINT NOT NULL DEFAULT 0,
    "recovery_balance" BIGINT NOT NULL DEFAULT 0,
    "lifetime_credited" BIGINT NOT NULL DEFAULT 0,
    "lifetime_debited" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ove_transactions" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "transaction_code" TEXT NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "balance_before" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "source_service" TEXT,
    "source_reference_id" TEXT,
    "related_transaction_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_type" "CreatedByType" NOT NULL,
    "created_by_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ove_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_rules" (
    "id" TEXT NOT NULL,
    "rule_code" TEXT NOT NULL,
    "rule_name" TEXT NOT NULL,
    "source_service" "ServiceCode" NOT NULL,
    "reward_amount" BIGINT NOT NULL,
    "per_user_limit" INTEGER,
    "per_event_limit" INTEGER,
    "monthly_count_limit" INTEGER,
    "monthly_amount_limit" BIGINT,
    "global_amount_limit" BIGINT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "approval_type" "ApprovalType" NOT NULL DEFAULT 'AUTOMATIC',
    "status" "RewardRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_holds" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "WalletHoldStatus" NOT NULL DEFAULT 'HELD',
    "held_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_type" "CreatedByType" NOT NULL,
    "actor_id" TEXT,
    "action_type" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "result" "AuditResult" NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "request_type" "ApprovalRequestType" NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_grant_batches" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "total_count" INTEGER NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "unknown_user_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount" BIGINT NOT NULL,
    "status" "BulkGrantBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "result_file_url" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executed_at" TIMESTAMP(3),

    CONSTRAINT "bulk_grant_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_batches" (
    "id" TEXT NOT NULL,
    "batch_name" TEXT NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "source_data_hash" TEXT NOT NULL,
    "executed_by" TEXT NOT NULL,
    "verified_by" TEXT,
    "status" "MigrationBatchStatus" NOT NULL DEFAULT 'PENDING',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "reviewing_count" INTEGER NOT NULL DEFAULT 0,
    "error_detail" TEXT,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_migrations" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "snapshot_balance" BIGINT NOT NULL,
    "conversion_rate" DECIMAL(65,30) NOT NULL,
    "token_amount" DECIMAL(65,30),
    "network" TEXT,
    "wallet_address" TEXT,
    "contract_address" TEXT,
    "tx_hash" TEXT,
    "status" "BlockchainMigrationStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ove_accounts_account_code_key" ON "ove_accounts"("account_code");

-- CreateIndex
CREATE INDEX "account_identities_ove_account_id_idx" ON "account_identities"("ove_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_identities_provider_provider_subject_key" ON "account_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "service_integrations_service_code_key" ON "service_integrations"("service_code");

-- CreateIndex
CREATE INDEX "account_links_ove_account_id_idx" ON "account_links"("ove_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_links_service_integration_id_external_user_id_key" ON "account_links"("service_integration_id", "external_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_token_hash_key" ON "user_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_ove_account_id_idx" ON "user_sessions"("ove_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_admin_code_key" ON "admin_users"("admin_code");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_ove_account_id_key" ON "wallets"("ove_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_wallet_code_key" ON "wallets"("wallet_code");

-- CreateIndex
CREATE UNIQUE INDEX "ove_transactions_transaction_code_key" ON "ove_transactions"("transaction_code");

-- CreateIndex
CREATE UNIQUE INDEX "ove_transactions_idempotency_key_key" ON "ove_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "ove_transactions_wallet_id_idx" ON "ove_transactions"("wallet_id");

-- CreateIndex
CREATE INDEX "ove_transactions_source_service_source_reference_id_idx" ON "ove_transactions"("source_service", "source_reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_rules_rule_code_key" ON "reward_rules"("rule_code");

-- CreateIndex
CREATE INDEX "wallet_holds_wallet_id_idx" ON "wallet_holds"("wallet_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_idx" ON "audit_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "blockchain_migrations_wallet_id_idx" ON "blockchain_migrations"("wallet_id");

-- AddForeignKey
ALTER TABLE "ove_accounts" ADD CONSTRAINT "ove_accounts_merged_into_account_id_fkey" FOREIGN KEY ("merged_into_account_id") REFERENCES "ove_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identities" ADD CONSTRAINT "account_identities_ove_account_id_fkey" FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_ove_account_id_fkey" FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_service_integration_id_fkey" FOREIGN KEY ("service_integration_id") REFERENCES "service_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_ove_account_id_fkey" FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_ove_account_id_fkey" FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ove_transactions" ADD CONSTRAINT "ove_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ove_transactions" ADD CONSTRAINT "ove_transactions_related_transaction_id_fkey" FOREIGN KEY ("related_transaction_id") REFERENCES "ove_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_migrations" ADD CONSTRAINT "blockchain_migrations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
