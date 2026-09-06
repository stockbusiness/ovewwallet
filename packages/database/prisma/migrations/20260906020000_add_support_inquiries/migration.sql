-- 利用者からの問い合わせ (docs/support-inquiries.md)。
--
-- 退会はできるようになったが、「付与されない」「残高が合わない」ときに利用者が
-- 取れる行動が無かった。メールアドレスの案内だけでは、問い合わせの内容から
-- どのアカウントの話か分からず調べようがないため、本人のセッションから受ける。
CREATE TYPE "SupportInquiryCategory" AS ENUM (
  'REWARD_NOT_GRANTED',
  'BALANCE_MISMATCH',
  'LOGIN_OR_ACCOUNT',
  'COLLECTIBLE',
  'OTHER'
);

CREATE TYPE "SupportInquiryStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED');

CREATE TABLE "support_inquiries" (
  "id" TEXT NOT NULL,
  "inquiry_code" TEXT NOT NULL,
  "ove_account_id" TEXT NOT NULL,
  "category" "SupportInquiryCategory" NOT NULL,
  "message" TEXT NOT NULL,
  "status" "SupportInquiryStatus" NOT NULL DEFAULT 'OPEN',
  "internal_note" TEXT,
  "reply_notice_id" TEXT,
  "answered_at" TIMESTAMP(3),
  "answered_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "support_inquiries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_inquiries_inquiry_code_key" ON "support_inquiries"("inquiry_code");
CREATE INDEX "support_inquiries_status_created_at_idx" ON "support_inquiries"("status", "created_at");
CREATE INDEX "support_inquiries_ove_account_id_idx" ON "support_inquiries"("ove_account_id");

ALTER TABLE "support_inquiries"
  ADD CONSTRAINT "support_inquiries_ove_account_id_fkey"
  FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
