-- 個別通知 (docs/notices-read-tracking.md「個別通知」)。
-- notices.ove_account_id が null なら従来どおり全員向け、値があればその利用者にだけ表示する。
-- 既存行はすべて null になるため、これまでのお知らせの見え方は変わらない。
ALTER TABLE "notices" ADD COLUMN "ove_account_id" TEXT;

ALTER TABLE "notices"
  ADD CONSTRAINT "notices_ove_account_id_fkey"
  FOREIGN KEY ("ove_account_id") REFERENCES "ove_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "notices_ove_account_id_idx" ON "notices"("ove_account_id");

-- 失効予告を送った印。同じロットについて毎日繰り返し通知しないために使う
-- (apps/api/src/scheduler/expiry-notice.service.ts)。
ALTER TABLE "ove_credit_lots" ADD COLUMN "expiry_notice_sent_at" TIMESTAMP(3);
