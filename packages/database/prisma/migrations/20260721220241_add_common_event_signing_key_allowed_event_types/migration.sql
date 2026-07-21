-- AlterTable
ALTER TABLE "common_event_signing_keys" ADD COLUMN     "allowed_event_types" TEXT[] DEFAULT ARRAY[]::TEXT[];
