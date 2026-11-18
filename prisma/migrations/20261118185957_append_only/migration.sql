-- The audit log is the record of who changed what. Rows may be added, never
-- changed or removed. Enforced in the database so no code path can bypass it.
-- Undo: DROP TRIGGER audit_log_append_only ON "AuditLog"; DROP FUNCTION reject_append_only_change();
CREATE FUNCTION reject_append_only_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only: rows in % cannot be changed or deleted', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
