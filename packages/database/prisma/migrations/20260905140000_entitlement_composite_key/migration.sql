-- entitlement_id をマーケット単位で一意にする (docs/collectible-multi-market.md)。
--
-- これまで entitlement_id はテーブル全体でUNIQUEだった。これは「繋ぐマーケットが
-- 1つなのでIDが衝突しない」という前提に依存しており、2つ目のマーケットを繋ぐと
-- 偶然同じIDを発行した瞬間に、片方のカードがもう片方に上書きされるか付与が拒否される。
--
-- 一意性の単位は生の source_system_key ではなく**論理Market**にする。
-- sennokuni-nft-market と sengoku-market は同一マーケットの新旧表記であり、
-- 生の値で分けると同じカードを二重に持ってしまうため。

-- 1. 列を足す (この時点では既存行が空なのでNULL許容で入れる)
ALTER TABLE "collectible_holdings" ADD COLUMN "logical_market" TEXT;
ALTER TABLE "collectible_entitlement_tombstones" ADD COLUMN "logical_market" TEXT;

-- 2. 既存行を埋める。現在受理しているのは下記2つだけなので、それ以外が入っていた場合は
--    生の値をそのまま論理Market名として使う (別マーケット扱いになり、取り違えない側に倒す)。
UPDATE "collectible_holdings"
SET "logical_market" = CASE
  WHEN "source_system_key" IN ('sennokuni-nft-market', 'sengoku-market') THEN 'nft-art-market'
  ELSE "source_system_key"
END;

UPDATE "collectible_entitlement_tombstones"
SET "logical_market" = CASE
  WHEN "source_system_key" IN ('sennokuni-nft-market', 'sengoku-market') THEN 'nft-art-market'
  ELSE "source_system_key"
END;

-- 3. 埋め終わったので必須にする
ALTER TABLE "collectible_holdings" ALTER COLUMN "logical_market" SET NOT NULL;
ALTER TABLE "collectible_entitlement_tombstones" ALTER COLUMN "logical_market" SET NOT NULL;

-- 4. 旧: テーブル全体での一意制約を外す
DROP INDEX "collectible_holdings_entitlement_id_key";
DROP INDEX "collectible_entitlement_tombstones_entitlement_id_key";

-- 5. 新: 論理Marketとの複合で一意にする
CREATE UNIQUE INDEX "collectible_holdings_logical_market_entitlement_id_key"
  ON "collectible_holdings"("logical_market", "entitlement_id");
CREATE UNIQUE INDEX "collectible_entitlement_tombstones_logical_market_entitlem_key"
  ON "collectible_entitlement_tombstones"("logical_market", "entitlement_id");
