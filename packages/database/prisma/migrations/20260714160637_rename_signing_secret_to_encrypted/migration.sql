/*
  Warnings:

  - You are about to drop the column `signing_secret_hash` on the `service_integrations` table. All the data in the column will be lost.
  - Added the required column `signing_secret_encrypted` to the `service_integrations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "service_integrations" DROP COLUMN "signing_secret_hash",
ADD COLUMN     "signing_secret_encrypted" TEXT NOT NULL;
