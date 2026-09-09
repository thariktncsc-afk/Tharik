/**
 * Empty ONE shop's transactional stores, leaving every other shop untouched.
 *
 *   node tools/clear-crs-testdata.mjs --crs=1            dry run — shows what would go
 *   node tools/clear-crs-testdata.mjs --crs=1 --write    actually clears
 *
 * For a shop that was keyed with sample data and needs to start again. Unlike
 * clear-transactional-data.mjs, which empties a store outright, this one keeps
 * the store and removes only the records belonging to the named shop.
 *
 * SAFETY
 *
 * - An explicit ALLOWLIST. Anything not named below is refused, so a typo
 *   cannot reach a master store. There is no pattern match and no
 *   "everything except" rule.
 * - The shop is matched by the NUMBER before the first underscore, never by
 *   string prefix: `1_2026-09-30` belongs to CRS 1, `10_2026-09-30` does not,
 *   and a prefix test would take both. Receipts are an array and are matched
 *   on their own crsId field.
 * - It UPDATES rows, removing keys. The store row, its version and its audit
 *   history survive, and crs_state_audit records the clearing itself.
 * - No DROP, no TRUNCATE, no schema change. It never opens `users`,
 *   `payment_*` or `crs_state_audit` — staff accounts, money records and the
 *   audit trail are not transactional data and are not this script's business.
 * - Every record it would remove is printed before anything is written, and
 *   afterwards it re-reads and proves that the other shops' records and the
 *   masters are byte-for-byte what they were.
 * - Take tools/snapshot-all-state.mjs first; that snapshot restores this.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

readFileSync('.env.local', 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1];
const CRS = Number(arg('crs'));
const write = process.argv.includes('--write');
if (!Number.isInteger(CRS) || CRS < 1) {
  console.error('Pass the shop as --crs=<n>, e.g. --crs=1');
  process.exit(1);
}

/** Keyed `<crs>_<...>`; the module they belong to, for the report. */
const KEYED = {
  entryStore: 'Daily Sales (and the remittance recorded on each day sheet)',
  inspectionStore: 'Inspection adjustments',
  monthlyStore: 'Published monthly figures',
  meManualStore: 'Monthly Entry — hand-keyed figures',
  meSourceStore: 'Monthly Entry — per-commodity source flags',
  meRemitStore: 'Monthly Remittance',
  meGunnyStore: 'Gunny / Poly / C.Box',
  meCardStore: 'Card Details — the monthly counts',
  meAllotStore: 'Allotment — the monthly quantities',
  meAdvanceStore: 'Advance figures',
  meCardConfirmed: 'Card Details — confirmed flags',
  salesCloseStore: 'Sales Close marks',
};
/** An array store, matched on each row's own crsId. */
const ARRAY_STORES = { receiptStore: 'Receipt Register' };
/** Approval bookkeeping — not keyed by shop, filtered by who and what. */
const CLEAR_STORE = '__clearRequests';

const allowed = new Set([...Object.keys(KEYED), ...Object.keys(ARRAY_STORES), CLEAR_STORE]);

/**
 * Named so a reader can see they were considered and deliberately spared.
 * Editing this list is not enough to clear them — they are not in `allowed`.
 */
const KEEP = [
  ['__shops', 'Shop names'],
  ['__crsMaster', 'Shop code, BC/Packer, COLL, police, usage status'],
  ['__commodities', 'Commodity id list'],
  ['__commodityMaster', 'Commodity master with rates'],
  ['__config', 'Organisation, region, account labels'],
  ['__accounts', 'Per-shop cereal account numbers'],
  ['__holidays', 'Government holiday calendar'],
  ['__pvOfficers', 'PV Officer groups and visit dates'],
  ['__counters', 'AMBIGUOUS — next-id pointers shared by every shop'],
  ['userStore__pre_0002', 'Pre-migration staff roster. User data.'],
];

/** The shop a store key belongs to — the number, not a string prefix. */
const crsOf = (key) => {
  const m = /^(\d+)_/.exec(key);
  return m ? Number(m[1]) : null;
};

const { data: rows, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global');
if (error) {
  console.error(error.message);
  process.exit(1);
}
const byKey = new Map(rows.map((r) => [r.store_key, r]));

/** What each store would lose. */
const plan = [];
for (const [store, label] of Object.entries(KEYED)) {
  const row = byKey.get(store);
  if (!row || !row.data || typeof row.data !== 'object') continue;
  const gone = Object.keys(row.data).filter((k) => crsOf(k) === CRS);
  if (gone.length) plan.push({ store, label, gone, next: Object.fromEntries(Object.entries(row.data).filter(([k]) => crsOf(k) !== CRS)), row });
}
for (const [store, label] of Object.entries(ARRAY_STORES)) {
  const row = byKey.get(store);
  if (!row || !Array.isArray(row.data)) continue;
  const gone = row.data.filter((r) => Number(r?.crsId) === CRS);
  if (gone.length) plan.push({ store, label, gone: gone.map((r) => `receipt ${r.receiptNo ?? r.id}`), next: row.data.filter((r) => Number(r?.crsId) !== CRS), row });
}
{
  const row = byKey.get(CLEAR_STORE);
  const d = row?.data;
  if (d && typeof d === 'object') {
    // An event names the shop in its detail ("CRS 1 2026-09-09") or is one of
    // that shop's own staff acting. \b keeps CRS 1 from matching CRS 10-19.
    const mine = (e) => e?.actor === `crs${CRS}` || new RegExp(`\\bCRS ${CRS}\\b`).test(String(e?.detail ?? ''));
    const events = (d.events ?? []).filter((e) => !mine(e));
    const requests = (d.requests ?? []).filter((r) => Number(r?.crsId) !== CRS);
    const goneCount = (d.events ?? []).length - events.length + ((d.requests ?? []).length - requests.length);
    if (goneCount) {
      plan.push({
        store: CLEAR_STORE,
        label: 'Clear-approval requests and their history',
        gone: [`${(d.events ?? []).length - events.length} event(s), ${(d.requests ?? []).length - requests.length} request(s)`],
        next: { ...d, events, requests },
        row,
      });
    }
  }
}

console.log(write ? `── CLEARING CRS ${CRS} ──\n` : `── DRY RUN for CRS ${CRS} — nothing will be written. Pass --write to apply. ──\n`);
if (!plan.length) console.log(`  CRS ${CRS} holds no transactional records. Nothing to do.\n`);
else {
  console.log('WILL REMOVE');
  for (const p of plan) {
    console.log(`  ${p.store.padEnd(18)} ${String(p.gone.length).padStart(3)}  ${p.label}`);
    for (const g of p.gone) console.log(`       └─ ${g}`);
  }
}
console.log('\nWILL NOT TOUCH');
for (const [k, why] of KEEP) console.log(`  ${k.padEnd(22)} ${why}`);
console.log('  other shops             every record whose key names a different CRS');
console.log('\n  Tables never opened: users, payment_orders, payment_settings, crs_state_audit\n');

// process.exit here trips a libuv assertion on Windows while the Supabase
// client still holds a socket; letting the module end closes it cleanly.
if (!write) { process.exitCode = 0; }
else {

/**
 * Everything that must NOT change, as comparable text — every master in full,
 * and from each shop store only the records belonging to OTHER shops. Run
 * before and after, it proves the clearing stayed inside CRS N.
 *
 * __clearRequests is filtered the same way rather than compared whole: this
 * script edits it on purpose, and comparing the whole row would report that
 * intended edit as collateral damage and drown the signal.
 */
const fingerprint = (rowsNow) => {
  const out = {};
  for (const r of rowsNow) {
    const d = r.data;
    if (r.store_key === CLEAR_STORE && d && typeof d === 'object') {
      const mine = (e) => e?.actor === `crs${CRS}` || new RegExp(`\\bCRS ${CRS}\\b`).test(String(e?.detail ?? ''));
      out[r.store_key] = JSON.stringify({
        seq: d.seq,
        events: (d.events ?? []).filter((e) => !mine(e)),
        requests: (d.requests ?? []).filter((x) => Number(x?.crsId) !== CRS),
      });
    } else if (Array.isArray(d)) out[r.store_key] = JSON.stringify(d.filter((x) => Number(x?.crsId) !== CRS));
    else if (d && typeof d === 'object' && !r.store_key.startsWith('__') && r.store_key !== 'userStore__pre_0002')
      out[r.store_key] = JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => crsOf(k) !== CRS)));
    else out[r.store_key] = JSON.stringify(d);
  }
  return out;
};
const before = fingerprint(rows);

let ok = 0;
for (const p of plan) {
  if (!allowed.has(p.store)) throw new Error(`refusing ${p.store}: not in the allowlist`);
  const { data, error: e } = await db
    .from('crs_state')
    .update({ data: p.next, version: p.row.version + 1, updated_at: new Date().toISOString(), updated_by: `cleanup:crs${CRS}` })
    .eq('scope', 'global')
    .eq('store_key', p.store)
    .eq('version', p.row.version)
    .select('version')
    .maybeSingle();
  if (e || !data) console.log(`FAIL  ${p.store}: ${e?.message ?? 'version changed while running — re-run'}`);
  else {
    ok++;
    console.log(`ok    ${p.store} (v${p.row.version} → v${data.version})`);
  }
}

const { data: after } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global');
const afterPrint = fingerprint(after);
const moved = Object.keys({ ...before, ...afterPrint }).filter((k) => before[k] !== afterPrint[k]);
const left = [];
for (const r of after) {
  const d = r.data;
  if (Array.isArray(d)) { if (d.some((x) => Number(x?.crsId) === CRS)) left.push(r.store_key); }
  else if (d && typeof d === 'object' && Object.keys(d).some((k) => crsOf(k) === CRS)) left.push(r.store_key);
}

console.log(`\n${ok}/${plan.length} store(s) updated.`);
console.log(`CRS ${CRS} records remaining: ${left.length ? left.join(', ') : 'none'}`);
console.log(`Everything outside CRS ${CRS} unchanged: ${moved.length ? `NO — ${moved.join(', ')}` : 'yes, byte-for-byte'}`);
process.exitCode = moved.length || left.length ? 1 : 0;
}
