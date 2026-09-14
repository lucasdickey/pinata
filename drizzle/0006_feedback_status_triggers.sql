-- Value domains for the D075 columns, enforced by triggers. SQLite cannot add
-- a CHECK constraint to an existing table without recreating it, and
-- recreating thread_entries would drop the append-only triggers installed by
-- 0001. These triggers reject any value outside the documented set the same
-- way a CHECK would, on insert and on update.
CREATE TRIGGER annotations_status_check_insert
BEFORE INSERT ON annotations
WHEN NEW.status NOT IN ('open', 'replied', 'resolved')
BEGIN
  SELECT RAISE(ABORT, 'annotations.status must be open, replied, or resolved');
END;
--> statement-breakpoint
CREATE TRIGGER annotations_status_check_update
BEFORE UPDATE OF status ON annotations
WHEN NEW.status NOT IN ('open', 'replied', 'resolved')
BEGIN
  SELECT RAISE(ABORT, 'annotations.status must be open, replied, or resolved');
END;
--> statement-breakpoint
CREATE TRIGGER thread_entries_kind_check_insert
BEFORE INSERT ON thread_entries
WHEN NEW.kind NOT IN ('message', 'status')
BEGIN
  SELECT RAISE(ABORT, 'thread_entries.kind must be message or status');
END;
