-- CreateTable
CREATE TABLE "common_user_hub_config" (
    "id" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "system_key" TEXT NOT NULL,
    "api_key_encrypted" TEXT,
    "api_key_preview" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "common_user_hub_config_pkey" PRIMARY KEY ("id")
);
