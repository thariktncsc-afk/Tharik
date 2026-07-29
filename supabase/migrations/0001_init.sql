-- TNCSC CRS — initial schema (Option A: persistence layer)
--
-- The engine keeps its data in the global stores listed in BACKUP_STORES
-- (src/legacy/18-backup-init.js). This schema stores those stores verbatim as
-- JSONB, one row per (scope, store_key), so the engine's in-memory data model
-- is unchanged and `npm run verify:parity` still passes.
--
-- scope  — 'global' for shared stores, or a CRS id as text once a store is
--          partitioned per shop. entryStore keys are 'crsId_date', so it can be
--          split per shop later without a schema change.
-- version — optimistic concurrency. A writer must send the version it read;
--          a mismatch is rejected so two shops cannot silently clobber a store.

create table if not exists crs_state (
  scope       text        not null default 'global',
  store_key   text        not null,
  data        jsonb       not null default '{}'::jsonb,
  version     bigint      not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (scope, store_key)
);

comment on table  crs_state          is 'Engine stores persisted verbatim as JSONB (see BACKUP_STORES).';
comment on column crs_state.scope    is '''global'', or a CRS id as text when the store is partitioned per shop.';
comment on column crs_state.version  is 'Optimistic lock — incremented on every write, checked by the API.';

-- Besides the eleven BACKUP_STORES, these pseudo-stores are held the same way:
--   ('global', '__counters')     rpNextId / muNextId / muEditId
--   ('global', '__config')       APP_CONFIG
--   ('global', '__accounts')     CRS_ACCOUNTS
--   ('global', '__shops')        CRS_SHOPS
--   ('global', '__commodities')  COMMODITIES
--   ('global', '__crsMaster')    CRS_MASTER
--   ('global', '__holidays')     TN_GOVT_HOLIDAYS
--
-- The last four existed only as literals in src/legacy/*.js. They are seeded
-- from those literals on the first sign-in against an empty database, and the
-- database owns them from then on — nothing is read from the sources again.

create index if not exists crs_state_updated_at_idx on crs_state (updated_at desc);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- RLS is enabled with NO permissive policy on purpose. This project keeps its
-- own client-side login rather than Supabase Auth, so there is no auth.uid() to
-- write a policy against. With RLS on and no policy, the publishable/anon key
-- can read nothing — every request must go through the Next.js route handlers,
-- which use the secret key and authorise against the app's own session cookie.
--
-- If you later move to Supabase Auth, add policies here keyed on auth.uid()
-- and the browser can talk to Supabase directly.

alter table crs_state enable row level security;

-- ── Audit trail ─────────────────────────────────────────────────────────────
-- Every write is appended here. This is a government supply record; knowing who
-- changed a statement and when is worth the storage.

create table if not exists crs_state_audit (
  id          bigserial   primary key,
  scope       text        not null,
  store_key   text        not null,
  version     bigint      not null,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  data        jsonb       not null
);

create index if not exists crs_state_audit_lookup_idx
  on crs_state_audit (scope, store_key, updated_at desc);

alter table crs_state_audit enable row level security;

create or replace function crs_state_audit_fn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into crs_state_audit (scope, store_key, version, updated_by, data)
  values (new.scope, new.store_key, new.version, new.updated_by, new.data);
  return new;
end $$;

drop trigger if exists crs_state_audit_trg on crs_state;
create trigger crs_state_audit_trg
  after insert or update on crs_state
  for each row execute function crs_state_audit_fn();
