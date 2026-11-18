-- Ledger integrity, enforced by the database so no code path can bypass it.
-- 1. Entries and lines are append-only (reuses reject_append_only_change from the audit-log migration).
-- 2. Every entry's lines must sum to zero. Checked at commit time (deferred) so an entry
--    and its lines can be written in any order inside one transaction.
-- Undo: DROP TRIGGER ledger_entry_balanced ON "LedgerLine";
--       DROP FUNCTION check_ledger_entry_balanced();
--       DROP TRIGGER ledger_line_append_only ON "LedgerLine";
--       DROP TRIGGER ledger_entry_append_only ON "LedgerEntry";

CREATE TRIGGER ledger_entry_append_only
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

CREATE TRIGGER ledger_line_append_only
  BEFORE UPDATE OR DELETE ON "LedgerLine"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

CREATE FUNCTION check_ledger_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
  line_count integer;
BEGIN
  SELECT COALESCE(SUM("amountPiasters"), 0), COUNT(*) INTO total, line_count
  FROM "LedgerLine" WHERE "entryId" = NEW."entryId";
  IF total <> 0 OR line_count < 2 THEN
    RAISE EXCEPTION 'unbalanced_entry: ledger entry % has % lines summing to %', NEW."entryId", line_count, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entry_balanced
  AFTER INSERT ON "LedgerLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ledger_entry_balanced();
