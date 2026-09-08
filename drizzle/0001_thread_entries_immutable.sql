-- Append-only enforcement for thread_entries (VAL-THREAD-002): no actor,
-- including the editor, may UPDATE or DELETE a thread entry. Annotation
-- tombstoning sets annotations.deleted_at and must leave entry bytes intact.
CREATE TRIGGER thread_entries_reject_update
BEFORE UPDATE ON thread_entries
BEGIN
  SELECT RAISE(ABORT, 'thread_entries are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER thread_entries_reject_delete
BEFORE DELETE ON thread_entries
BEGIN
  SELECT RAISE(ABORT, 'thread_entries are append-only');
END;
