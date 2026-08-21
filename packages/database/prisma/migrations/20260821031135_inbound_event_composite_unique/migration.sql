-- PR-W3-a-2: InboundEvent.eventId を単独UNIQUEから source_system_key + event_id の
-- 複合UNIQUEへ切り替える。
--
-- 実機確認 (pg_indexes / pg_constraint) 済み: "inbound_events_event_id_key" は
-- UNIQUE CONSTRAINTではなくUNIQUE INDEXとして存在する
-- (元の作成元: 20260721080219_add_common_integration_contract_v1/migration.sql の
-- `CREATE UNIQUE INDEX "inbound_events_event_id_key" ON "inbound_events"("event_id");`)。
-- そのため `ALTER TABLE ... DROP CONSTRAINT` ではなく `DROP INDEX` を使う。
--
-- 適用順序は意図的に「新インデックス作成 → 検証 → 旧インデックス削除」とする。
-- 逆順 (旧を先に削除) だと、新インデックス作成が失敗した場合に一意性の保証が
-- 一時的に失われる窓ができてしまうため。
--
-- 事前確認 (このマイグレーションが実行される前に別途read-onlyで確認する内容):
--   SELECT source_system_key, event_id, COUNT(*) FROM inbound_events
--   GROUP BY source_system_key, event_id HAVING COUNT(*) > 1;
--   → 重複が1件でもあれば、下のCREATE UNIQUE INDEXがエラーで失敗し
--     このマイグレーション自体が安全側に倒れて止まる。

-- CreateIndex (新: source_system_key + event_id の複合UNIQUE)
CREATE UNIQUE INDEX "inbound_events_source_system_key_event_id_key" ON "inbound_events"("source_system_key", "event_id");

-- DropIndex (旧: event_id単独UNIQUE)
DROP INDEX "inbound_events_event_id_key";
