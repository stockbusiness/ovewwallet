-- カード画像の保管先を管理画面から設定できるようにする (docs/collectible-images.md)。
-- mail_config と同じくシングルトン行で、環境変数より優先される
-- (鍵の入れ替えにデプロイを待たせないため)。
CREATE TABLE "collectible_image_storage_config" (
    "id" TEXT NOT NULL,
    "bucket" TEXT,
    "endpoint" TEXT,
    "region" TEXT,
    "access_key_id" TEXT,
    "secret_access_key_encrypted" TEXT,
    "secret_access_key_preview" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "collectible_image_storage_config_pkey" PRIMARY KEY ("id")
);
