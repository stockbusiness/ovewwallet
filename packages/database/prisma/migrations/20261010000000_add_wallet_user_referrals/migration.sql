-- ウォレット利用者同士の紹介 (docs/wallet-user-referral.md)。
-- 代理店紹介 (wallet_referrals) とは別テーブルにする。あちらは代理店システムの
-- capture/confirm APIと一対一で、referral_token_encrypted が必須のため。

CREATE TYPE "WalletUserReferralStatus" AS ENUM ('CAPTURED', 'REGISTERED', 'INHERITED', 'EXCLUDED', 'EXPIRED');

ALTER TABLE "ove_accounts" ADD COLUMN "wallet_referral_code" TEXT;

CREATE UNIQUE INDEX "ove_accounts_wallet_referral_code_key" ON "ove_accounts"("wallet_referral_code");

CREATE TABLE "wallet_user_referrals" (
    "id" TEXT NOT NULL,
    "referrer_account_id" TEXT NOT NULL,
    "referred_account_id" TEXT,
    "session_token_hash" TEXT NOT NULL,
    "status" "WalletUserReferralStatus" NOT NULL DEFAULT 'CAPTURED',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3),
    "inherited_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_user_referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_user_referrals_session_token_hash_key" ON "wallet_user_referrals"("session_token_hash");

-- 登録完了後は1アカウントにつき紹介元は1件のみ。PostgreSQLのunique indexはNULLを
-- 複数許容するため、登録前セッション (referred_account_id IS NULL) と両立できる。
CREATE UNIQUE INDEX "wallet_user_referrals_referred_account_id_key" ON "wallet_user_referrals"("referred_account_id");

CREATE INDEX "wallet_user_referrals_referrer_account_id_idx" ON "wallet_user_referrals"("referrer_account_id");
CREATE INDEX "wallet_user_referrals_status_idx" ON "wallet_user_referrals"("status");
CREATE INDEX "wallet_user_referrals_expires_at_idx" ON "wallet_user_referrals"("expires_at");

ALTER TABLE "wallet_user_referrals" ADD CONSTRAINT "wallet_user_referrals_referrer_account_id_fkey" FOREIGN KEY ("referrer_account_id") REFERENCES "ove_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_user_referrals" ADD CONSTRAINT "wallet_user_referrals_referred_account_id_fkey" FOREIGN KEY ("referred_account_id") REFERENCES "ove_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
