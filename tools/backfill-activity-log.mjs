/**
 * Rebuild the activity log's HISTORY from evidence the database already holds.
 *
 *   node tools/backfill-activity-log.mjs            dry run: what would be added
 *   node tools/backfill-activity-log.mjs --write    add it
 *   node tools/backfill-activity-log.mjs --preview  what the evidence yields, before the table exists
 *
 * Needs migrations 0006 and 0008. Every row it adds is `historical = true` and
 * carries a `backfill_key` naming the evidence, so a second run adds nothing.
 * It only ever INSERTS into activity_log — no operational row is written.
 *
 * THE EVIDENCE, AND WHAT IT CAN HONESTLY SAY
 *
 *   crs_state_audit   every version of every store, with who (updated_by) and
 *                     when (updated_at). Consecutive versions are diffed with
 *                     the same rules the live log uses (activityLog/core.ts),
 *                     so before → after values are the real stored figures.
 *                     A store's first audited version is a baseline unless it
 *                     is version 1 (then its records were created then).
 *   payment_orders    created_at by the ordering user; submitted_at (the
 *                     submitter is NOT recorded — left blank, not guessed);
 *                     decided_at by decided_by / decided_by_name.
 *   __clearRequests   its own event list: who, role, when, what.
 *   users             created_at for accounts that still exist (who created
 *                     them is not recorded — left blank).
 *
 * WHO. A username that belongs to one account is that person, with their name
 * and role. A shop login shared by its BC and Packer (crs7, crs20, crs24,
 * crs25) cannot say which of them it was, so the login is shown and the role is
 * left blank. Writes by maintenance tools ("import:xlsx", "cleanup:…",
 * "repair:…") are System. Nothing is invented.
 *
 * WHERE IT STOPS. Only evidence older than the first live (non-historical)
 * log row is used — from then on the live log already has it.
 */
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) return next(${JSON.stringify(srcUrl)} + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}`)}`,
  import.meta.url,
);
const { createClient } = createRequire(join(root, 'package.json'))('@supabase/supabase-js');
const L = await import(pathToFileURL(join(root, 'src/lib/activityLog/core.ts')).href);

readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const write = process.argv.includes('--write');
const preview = process.argv.includes('--preview');

/** Stores whose history is not activity: derived output, counters, secrets, or recorded elsewhere. */
const SKIP = new Set(['monthlyStore', 'meSourceStore', '__counters', '__clearRequests', '__stockInit', 'userStore', 'userStore__pre_0002']);

async function main() {
  const probe = preview ? { error: null } : await db.from('activity_log').select('id, historical, backfill_key').limit(1);
  if (probe.error) {
    console.error(`The activity log is not ready: ${probe.error.message}\nRun supabase/migrations/0006_activity_log.sql and 0008_activity_log_complete.sql first.`);
    return 1;
  }

  // Stop where the live log begins.
  const { data: firstLive } = preview ? { data: [] } : await db.from('activity_log').select('at').eq('historical', false).order('at', { ascending: true }).limit(1);
  const cutoff = firstLive?.[0]?.at ? new Date(firstLive[0].at).getTime() : Date.now();
  console.log(`evidence before ${new Date(cutoff).toISOString()} is used`);

  const { data: users, error: uErr } = await db.from('users').select('id, username, full_name, role, crs_id, phone, created_at');
  if (uErr) throw uErr;
  const byName = new Map();
  for (const u of users) {
    for (const k of [u.username, u.phone].filter(Boolean)) byName.set(String(k), [...(byName.get(String(k)) ?? []), u]);
  }
  const who = (login, fallbackRole = '') => {
    const name = String(login ?? '').trim();
    if (!name) return { actor_user_id: null, actor_username: '', actor_name: '', actor_role: '', actor_crs_id: null, source: 'user' };
    if (name.includes(':') || name === 'system') {
      return { actor_user_id: null, actor_username: name, actor_name: `Maintenance (${name})`, actor_role: 'SYSTEM', actor_crs_id: null, source: 'system' };
    }
    const found = byName.get(name) ?? [];
    if (found.length === 1) {
      const u = found[0];
      return { actor_user_id: Number(u.id), actor_username: String(u.username), actor_name: String(u.full_name || u.username), actor_role: String(u.role || ''), actor_crs_id: u.crs_id ?? null, source: 'user' };
    }
    // Shared shop login: which of its people it was is not on record.
    const shop = found.length && found.every((u) => u.crs_id === found[0].crs_id) ? found[0].crs_id : null;
    const role = found.length ? '' : fallbackRole;
    return { actor_user_id: null, actor_username: name, actor_name: name, actor_role: role, actor_crs_id: shop, source: 'user' };
  };

  const { data: existing } = preview ? { data: [] } : await db.from('activity_log').select('backfill_key').eq('historical', true).not('backfill_key', 'is', null).limit(100000);
  const have = new Set((existing ?? []).map((r) => r.backfill_key));
  const rows = [];
  const add = (key, at, actor, d) => {
    if (have.has(key) || new Date(at).getTime() >= cutoff) return;
    rows.push({
      at,
      ...actor,
      source: actor.source === 'system' ? 'system' : d.source,
      crs_id: d.crsId ?? null,
      shop_name: '',
      module: d.module,
      action: d.action,
      entry_date: d.entryDate ?? null,
      entry_month: d.entryMonth ?? null,
      entry_year: d.entryYear ?? null,
      record_key: d.recordKey ?? null,
      summary: String(d.summary ?? '').slice(0, 500),
      changes: (d.changes ?? []).slice(0, 150),
      related_id: d.relatedId ?? null,
      historical: true,
      backfill_key: key,
    });
  };

  // ── crs_state_audit: every version, diffed against the one before ────────
  const prev = new Map();
  let lastId = 0;
  let versions = 0;
  for (;;) {
    const { data, error } = await db.from('crs_state_audit').select('id, store_key, version, updated_at, updated_by, data').eq('scope', 'global').gt('id', lastId).order('id', { ascending: true }).limit(40);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) {
      lastId = r.id;
      versions++;
      if (SKIP.has(r.store_key)) continue;
      const had = prev.has(r.store_key);
      const before = prev.get(r.store_key);
      prev.set(r.store_key, r.data);
      // The first version audited: a creation only if it IS the first version.
      if (!had && Number(r.version) !== 1) continue;
      const drafts = L.diffStateWrite({ [r.store_key]: had ? before : undefined }, { [r.store_key]: r.data });
      const actor = who(r.updated_by);
      drafts.forEach((d, i) => add(`audit:${r.id}:${i}`, r.updated_at, actor, d));
    }
  }

  // ── payment orders ───────────────────────────────────────────────────────
  const { data: orders, error: oErr } = await db.from('payment_orders').select('*').order('id');
  if (oErr && !['PGRST205', '42P01'].includes(oErr.code)) throw oErr;
  for (const o of orders ?? []) {
    const order = {
      id: o.id, orderNo: o.order_no, crsId: o.crs_id, kind: o.kind, month: o.month, year: o.year,
      sheetCount: o.sheet_count, dayCount: o.day_count, totalPaise: o.total_paise, utr: o.utr, rejectReason: o.reject_reason,
    };
    const orderer = users.find((u) => Number(u.id) === Number(o.user_id));
    const ordererActor = orderer
      ? { actor_user_id: Number(orderer.id), actor_username: orderer.username, actor_name: orderer.full_name || orderer.username, actor_role: orderer.role, actor_crs_id: orderer.crs_id, source: 'user' }
      : { actor_user_id: o.user_id ?? null, actor_username: o.username ?? '', actor_name: o.full_name || o.username || '', actor_role: '', actor_crs_id: o.crs_id ?? null, source: 'user' };
    if (o.created_at) add(`payment:${o.id}:created`, o.created_at, ordererActor, L.paymentDraft(order, 'created'));
    if (o.submitted_at) {
      const d = L.paymentDraft(order, 'submitted');
      add(`payment:${o.id}:submitted`, o.submitted_at, { actor_user_id: null, actor_username: '', actor_name: '', actor_role: '', actor_crs_id: null, source: 'user' }, { ...d, summary: `${d.summary} · submitter not recorded` });
    }
    if (o.decided_at && (o.status === 'approved' || o.status === 'rejected')) {
      const decider = users.find((u) => Number(u.id) === Number(o.decided_by));
      const actor = decider
        ? { actor_user_id: Number(decider.id), actor_username: decider.username, actor_name: decider.full_name || decider.username, actor_role: decider.role, actor_crs_id: decider.crs_id, source: 'user' }
        : { actor_user_id: o.decided_by ?? null, actor_username: '', actor_name: o.decided_by_name || '', actor_role: '', actor_crs_id: null, source: 'user' };
      add(`payment:${o.id}:${o.status}`, o.decided_at, actor, L.paymentDraft(order, o.status));
    }
  }

  // ── clear requests: their own event list ─────────────────────────────────
  const { data: cr } = await db.from('crs_state').select('data').eq('scope', 'global').eq('store_key', '__clearRequests').maybeSingle();
  const requests = new Map((cr?.data?.requests ?? []).map((r) => [Number(r.id), r]));
  (cr?.data?.events ?? []).forEach((ev, i) => {
    const r = ev.requestId == null ? null : requests.get(Number(ev.requestId));
    const actor = who(ev.actor, ev.actorRole);
    if (!actor.actor_role && ev.actorRole && actor.actor_user_id !== null) actor.actor_role = ev.actorRole;
    const map = { requested: 'requested', approved: 'approved', rejected: 'rejected', cancelled: 'cancelled', cleared: 'cleared', failed: 'failed', blocked: 'refused' };
    const action = map[ev.event];
    if (!action) return;
    const crsId = r?.crsId ?? (/CRS (\d+)/.exec(ev.detail ?? '')?.[1] ? Number(/CRS (\d+)/.exec(ev.detail)[1]) : null);
    const scope = r && r.storeKeys?.length === 1 ? L.entryOf(r.storeKeys[0]) : {};
    add(`clear-event:${i}:${ev.at}`, ev.at, actor, {
      ...scope, crsId, module: 'Clear Request', action, source: 'user', relatedId: r ? String(r.id) : null,
      recordKey: r?.storeKeys?.join(', ')?.slice(0, 300) ?? null,
      summary: `${r ? `Request #${r.id} · ` : ''}${ev.detail ?? ''}`.slice(0, 500),
      changes: [{ label: 'Event', before: '', after: String(ev.detail ?? ev.event) }],
    });
  });

  // ── user accounts that still exist ───────────────────────────────────────
  for (const u of users) {
    if (!u.created_at) continue;
    add(`user:${u.id}:created`, u.created_at, { actor_user_id: null, actor_username: '', actor_name: '', actor_role: '', actor_crs_id: null, source: 'user' }, {
      crsId: u.crs_id ?? null, module: 'Users', action: 'created', source: 'user', recordKey: String(u.id),
      summary: `${u.full_name || u.username} (${L.roleLabel(u.role)}) account created · creator not recorded`,
      changes: [
        { label: 'Username', before: '—', after: String(u.username) },
        { label: 'Role', before: '—', after: L.roleLabel(u.role) },
        { label: 'Shop', before: '—', after: u.crs_id ? `CRS ${u.crs_id}` : 'No shop' },
      ],
    });
  }

  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const tally = {};
  for (const r of rows) tally[`${r.module} · ${r.action}${r.source === 'system' ? ' (system)' : ''}`] = (tally[`${r.module} · ${r.action}${r.source === 'system' ? ' (system)' : ''}`] ?? 0) + 1;
  console.log(`${versions} store versions read; ${rows.length} historical activities to add${have.size ? ` (${have.size} already present, skipped)` : ''}`);
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
  const span = rows.length ? `${rows[0].at.slice(0, 10)} → ${rows[rows.length - 1].at.slice(0, 10)}` : '—';
  console.log(`span: ${span}`);
  if (preview) {
    for (const r of rows.filter((x) => x.crs_id === 7 && x.module === 'Daily Sales').slice(-3)) console.log('  e.g.', r.at, r.actor_name, r.actor_role || '(role not recorded)', r.module, r.action, r.entry_date, '·', r.summary.slice(0, 120));
  }
  if (!write || preview) {
    console.log('DRY RUN — pass --write to add them.');
    return 0;
  }
  let done = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('activity_log').insert(rows.slice(i, i + 200));
    if (error) {
      console.error(`insert failed after ${done} rows: ${error.message} — run again; rows already added are skipped`);
      return 1;
    }
    done += Math.min(200, rows.length - i);
  }
  console.log(`ADDED ${done} historical activities`);
  return 0;
}

process.exitCode = await main();
