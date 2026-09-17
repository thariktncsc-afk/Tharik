-- TNCSC CRS — one notification per waiting request
--
-- Run AFTER 0005_notifications.sql.
--
-- The service already checks for a pending notification before creating one
-- (src/lib/notify/server.ts notifyApprovalRequested). This makes the database
-- say the same thing, so two submits racing each other, or two servers
-- backfilling waiting requests at the same moment, still leave exactly one.
--
-- Partial on purpose: once a request is decided its notification leaves
-- `pending`, so a payment rejected and resubmitted gets a fresh notification
-- for the new submission while the old one stays in history as "rejected".
--
-- Additive only: an index, no data changed. If duplicates already exist the
-- index cannot be built and the statement fails — nothing is deleted for it.

create unique index if not exists notifications_one_pending_request
  on notifications (related_module, related_request_id, type)
  where status = 'pending' and related_request_id is not null and type <> 'APPROVAL_RESULT';

notify pgrst, 'reload schema';
