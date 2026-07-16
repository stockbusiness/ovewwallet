-- AlterEnum
ALTER TYPE "AccountLinkStatus" ADD VALUE 'PENDING';

-- AlterEnum
ALTER TYPE "IdentityType" ADD VALUE 'SENGOKU_AGENCY';

-- AlterEnum
ALTER TYPE "ServiceCode" ADD VALUE 'AGENCY_SYSTEM';

-- DropForeignKey
ALTER TABLE "account_links" DROP CONSTRAINT "account_links_ove_account_id_fkey";

-- AlterTable
ALTER TABLE "account_links" ALTER COLUMN "ove_account_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_ove_account_id_fkey" FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
