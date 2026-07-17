-- ove_transactions のDBレベル保護 (実装指示書「OVEウォレット 今後の実装・運用指示書 v1.0」5.1章)
--
-- audit_logs と同じ理由 (アプリはpostgresの特権ユーザーで接続しており、GRANT/REVOKEに
-- よる権限剥奪はスーパーユーザーに効果がないため、BEFOREトリガーで拒否する) で、
-- 台帳の中核テーブルであるove_transactionsを以下の通り保護する。
--
-- - DELETEは常に拒否する (取消は必ずREVERSAL取引の追加で行う設計のため)。
-- - COMPLETED状態の取引について、amount/direction/wallet_id/transaction_type/
--   idempotency_keyの変更を拒否する。statusのみの変更 (COMPLETED -> REVERSED、
--   `packages/ledger/src/reversal.ts`が行う唯一のUPDATE) は許可する。
--   PENDING/HELD状態の取引は対象外 (現状アプリはこれらのステータスのoveTransaction行を
--   UPDATEしない。将来的な状態遷移の実装を妨げないため、指示書の記載通りCOMPLETED時のみに限定する)。

CREATE OR REPLACE FUNCTION prevent_ove_transactions_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ove_transactions is append-only: DELETE is not allowed on ove_transactions (取引は削除できません。取消はREVERSAL取引を追加してください)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ove_transactions_prevent_delete
  BEFORE DELETE ON "ove_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_ove_transactions_deletion();

CREATE OR REPLACE FUNCTION prevent_completed_ove_transaction_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'COMPLETED' AND (
    NEW.amount IS DISTINCT FROM OLD.amount OR
    NEW.direction IS DISTINCT FROM OLD.direction OR
    NEW.wallet_id IS DISTINCT FROM OLD.wallet_id OR
    NEW.transaction_type IS DISTINCT FROM OLD.transaction_type OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  ) THEN
    RAISE EXCEPTION 'ove_transactions: cannot change amount/direction/wallet_id/transaction_type/idempotency_key of a COMPLETED transaction (完了済み取引のamount/direction/wallet_id/transaction_type/idempotency_keyは変更できません)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ove_transactions_prevent_completed_mutation
  BEFORE UPDATE ON "ove_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_completed_ove_transaction_mutation();
