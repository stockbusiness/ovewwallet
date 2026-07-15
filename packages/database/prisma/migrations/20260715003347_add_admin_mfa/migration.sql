-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_enrolled_at" TIMESTAMP(3),
ADD COLUMN     "mfa_secret_encrypted" TEXT;
