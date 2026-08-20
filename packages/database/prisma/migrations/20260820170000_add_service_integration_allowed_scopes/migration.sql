-- AlterTable
ALTER TABLE "service_integrations" ADD COLUMN     "allowed_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
