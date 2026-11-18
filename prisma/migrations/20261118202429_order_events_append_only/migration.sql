-- The order timeline is the record of what happened to a parcel. Rows may be
-- added, never changed or removed. Reuses the function from the audit-log migration.
-- Undo: DROP TRIGGER order_event_append_only ON "OrderEvent";
CREATE TRIGGER order_event_append_only
  BEFORE UPDATE OR DELETE ON "OrderEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
