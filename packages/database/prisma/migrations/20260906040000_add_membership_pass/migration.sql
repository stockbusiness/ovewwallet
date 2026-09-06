-- 会員券を扱う千ノ国マーケット (sengoku-commerce) の受け入れ
-- (docs/collectible-multi-market.md)。
--
-- 会員券には有効期限のあるものと無いものがある。期限は日付から都度判定するため、
-- status は書き換えない (取消 REVOKED と期限切れは別の事実で、時間の経過だけで
-- 状態が変わる更新を持ちたくない)。
CREATE TYPE "CollectibleHoldingKind" AS ENUM ('DIGITAL_COLLECTIBLE', 'MEMBERSHIP_PASS');

ALTER TABLE "collectible_holdings"
  ADD COLUMN "kind" "CollectibleHoldingKind" NOT NULL DEFAULT 'DIGITAL_COLLECTIBLE',
  ADD COLUMN "valid_from" TIMESTAMP(3),
  ADD COLUMN "valid_to" TIMESTAMP(3);

-- 既存行はすべてNFTアートマーケットのカードなので、既定値のままでよい。
