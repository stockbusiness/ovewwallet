-- メール送信 (ワンタイムコードの配信) の設定を管理画面から変更できるようにする。
-- 単一行 (id = 'default')。環境変数 RESEND_API_KEY でも設定できるが、この行が優先される
-- (鍵の入れ替えにデプロイを待たせないため。docs/login-methods.md)。
--
-- APIキーは CommonUserHubConfig.api_key_encrypted と同じ AES-256-GCM 可逆暗号化で保存し、
-- 生値は画面へ一切返さない (末尾4文字のみのマスク表示)。
CREATE TABLE "mail_config" (
    "id" TEXT NOT NULL,
    "api_key_encrypted" TEXT,
    "api_key_preview" TEXT,
    "mail_from" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "mail_config_pkey" PRIMARY KEY ("id")
);
