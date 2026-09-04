-- 代理店システム(AGENCY_SYSTEM)のORI付与に金額上限を設定する。
--
-- seed.tsはこの行を per_request_amount_limit = 0 / daily_amount_limit = 0 で作成して
-- いた。当時この経路 (PointAwardWalletDeliveryHandler) は ServiceIntegration の上限を
-- 参照しておらず、値が使われていなかったためである。上限を効かせるようにしたので、
-- 0のままだと全ての付与が拒否される。実際の運用値を入れる。
--
-- per_request_amount_limit = 3000: 初回登録時の付与額 (2026-09-04 運用確認)。
--   桁の間違い (3000 -> 30000) をここで止める。これを超える付与を始めるときは
--   この値を先に引き上げること。
-- daily_amount_limit = 1000000: 他のServiceIntegrationと同じ既定値。3000/件なら
--   1日333件相当で、業務上の上限ではなく暴走の検知線として置いている。
--
-- 既に運用側が値を入れている場合は上書きしない (0のときだけ設定する)。
UPDATE "service_integrations"
SET "per_request_amount_limit" = 3000,
    "daily_amount_limit" = 1000000
WHERE "service_code" = 'AGENCY_SYSTEM'
  AND "per_request_amount_limit" = 0
  AND "daily_amount_limit" = 0;
