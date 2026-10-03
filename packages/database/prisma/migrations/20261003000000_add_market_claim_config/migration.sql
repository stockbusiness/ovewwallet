-- 千ノ国マーケットの受取確認API (Claim) への接続設定を管理画面から編集できるようにする。
-- mail_config / collectible_image_storage_config と同じシングルトン行で、
-- 環境変数 SENGOKU_MARKET_CLAIM_* より優先される
-- (鍵の入れ替えにデプロイを待たせないため)。
CREATE TABLE "market_claim_config" (
    "id" TEXT NOT NULL,
    "base_url" TEXT,
    "key_id" TEXT,
    "hmac_secret_encrypted" TEXT,
    "hmac_secret_preview" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "market_claim_config_pkey" PRIMARY KEY ("id")
);
