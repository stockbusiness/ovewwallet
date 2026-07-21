-- CreateEnum
CREATE TYPE "InboundEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "CommonEventSigningKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'COMMON_EVENT_REWARD';

-- AlterTable
ALTER TABLE "ove_accounts" ADD COLUMN     "assigned_agency_id" TEXT,
ADD COLUMN     "registration_referrer_agency_id" TEXT;

-- AlterTable
ALTER TABLE "wallet_referrals" ADD COLUMN     "agency_sync_attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "canonical_referral_token_encrypted" TEXT,
ADD COLUMN     "referral_session_key" TEXT;

-- CreateTable
CREATE TABLE "inbound_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" TEXT NOT NULL,
    "source_system_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "correlation_id" TEXT,
    "status" "InboundEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "result_payload" JSONB,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "common_event_signing_keys" (
    "id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "source_system_key" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "status" "CommonEventSigningKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "common_event_signing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_events_event_id_key" ON "inbound_events"("event_id");

-- CreateIndex
CREATE INDEX "inbound_events_status_next_retry_at_idx" ON "inbound_events"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "inbound_events_source_system_key_event_type_idx" ON "inbound_events"("source_system_key", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "common_event_signing_keys_key_id_key" ON "common_event_signing_keys"("key_id");

-- CreateIndex
CREATE INDEX "common_event_signing_keys_source_system_key_status_idx" ON "common_event_signing_keys"("source_system_key", "status");
