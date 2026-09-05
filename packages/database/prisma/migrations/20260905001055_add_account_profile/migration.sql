-- 利用者プロフィール (氏名・電話・住所) を預かるための追加。
-- ORI付与を入口にしたリスト取りが目的で、後のアップセルに使う (docs/account-profile.md)。
--
-- 個人情報は ove_accounts に足さず専用テーブルに置く。保管・削除・匿名化の
-- 対象範囲をこのテーブル1つに閉じ込めるため。

-- 項目ごとの要求レベル。HIDDEN=欄を出さない、OPTIONAL=出すが未入力可、
-- REQUIRED=入力を求める (ただしウォレットの利用は妨げない)。
CREATE TYPE "ProfileFieldRequirement" AS ENUM ('HIDDEN', 'OPTIONAL', 'REQUIRED');

CREATE TABLE "account_profiles" (
    "ove_account_id" TEXT NOT NULL,
    "full_name" TEXT,
    "full_name_kana" TEXT,
    "phone" TEXT,
    "postal_code" TEXT,
    "prefecture" TEXT,
    "city" TEXT,
    "address_line" TEXT,
    "building" TEXT,
    -- 「入力しない」を明示的に選んだ日時。未入力放置と区別してセグメントするため。
    "declined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_profiles_pkey" PRIMARY KEY ("ove_account_id")
);

ALTER TABLE "account_profiles"
  ADD CONSTRAINT "account_profiles_ove_account_id_fkey"
  FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 管理画面から編集する単一行の設定 (id = 'default')。
CREATE TABLE "account_profile_config" (
    "id" TEXT NOT NULL,
    "full_name" "ProfileFieldRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "full_name_kana" "ProfileFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "phone" "ProfileFieldRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "postal_code" "ProfileFieldRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "address" "ProfileFieldRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "prompt_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "account_profile_config_pkey" PRIMARY KEY ("id")
);
