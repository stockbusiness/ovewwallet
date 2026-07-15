-- 監査ログ (audit_logs) の改ざん・削除防止 (指示書: 監査ログはDBレベルで削除不可にすること)
--
-- アプリケーションはPostgresの特権ユーザー (postgres) で接続しているため、
-- GRANT/REVOKEによる権限剥奪ではスーパーユーザーに効果がなく無意味である。
-- そのため、DELETE/UPDATEを常に例外で拒否するBEFOREトリガーを使い、
-- どのロールで接続していても (アプリのバグ・誤ったDB直接操作を含めて) 監査ログの
-- 改ざん・削除ができないようにする。

CREATE OR REPLACE FUNCTION prevent_audit_logs_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable: % is not allowed on audit_logs (監査ログは削除・変更できません)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_prevent_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_logs_mutation();

CREATE TRIGGER audit_logs_prevent_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_logs_mutation();
