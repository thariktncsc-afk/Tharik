-- TNCSC CRS — the activity log, completed: history, snapshots, and append-only.
--
-- Run AFTER 0006_activity_log.sql. Idempotent: safe to run again.
--
-- 1. HISTORY. The log did not exist while the app was already in use, but the
--    database kept evidence: every version of every crs_state store (with who
--    and when), payment orders with their timestamps, clear requests with their
--    event list, and user accounts. tools/backfill-activity-log.mjs rebuilds
--    what that evidence genuinely shows, marked `historical = true`, and never
--    invents a person, a time or a previous value it does not hold.
--    `backfill_key` names the piece of evidence each row came from, so running
--    the backfill twice adds nothing.
--
-- 2. SNAPSHOTS. `actor_crs_id` is the shop the person belonged to when they
--    acted. With the name and role already copied onto the row, a BC who is
--    later transferred, renamed or deleted still reads correctly in old rows.
--
-- 3. APPEND-ONLY. An audit trail that can be edited is not one. Updates,
--    deletes and truncation are refused by the database itself — for every
--    role, the service key included. Nothing in the app edits or deletes a row.
--
-- 4. ADMINISTRATORS ONLY. RLS stays on with no policy, and the public roles
--    hold no privileges on the table at all. Rows are served only by
--    /api/activity/log after it checks the session is an administrator's.

alter table activity_log add column if not exists historical   boolean not null default false;
alter table activity_log add column if not exists backfill_key text;
alter table activity_log add column if not exists actor_crs_id integer;

create unique index if not exists activity_log_backfill_key on activity_log (backfill_key) where backfill_key is not null;
create index if not exists activity_log_actor_crs_idx on activity_log (actor_crs_id, at desc);
create index if not exists activity_log_source_idx on activity_log (source, at desc);

comment on column activity_log.historical   is 'Rebuilt from evidence that predates the log (tools/backfill-activity-log.mjs).';
comment on column activity_log.backfill_key is 'The evidence a historical row came from — unique, so a re-run adds nothing.';
comment on column activity_log.actor_crs_id is 'The shop the person belonged to when they acted.';

create or replace function activity_log_append_only() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'activity_log is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists activity_log_no_update on activity_log;
create trigger activity_log_no_update before update or delete on activity_log
  for each row execute function activity_log_append_only();

drop trigger if exists activity_log_no_truncate on activity_log;
create trigger activity_log_no_truncate before truncate on activity_log
  for each statement execute function activity_log_append_only();

revoke all on function activity_log_append_only() from public;

alter table activity_log enable row level security;
revoke all on table activity_log from anon, authenticated;

notify pgrst, 'reload schema';
