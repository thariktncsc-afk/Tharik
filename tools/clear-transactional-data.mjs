/**
 * Empty the transactional stores so the office can key real data from scratch.
 *
 *   node tools/clear-transactional-data.mjs           dry run — shows what would go
 *   node tools/clear-transactional-data.mjs --write   actually clears
 *
 * SAFETY
 *
 * - An explicit ALLOWLIST. Anything not named below is refused, so a typo
 *   cannot reach a master store. There is no pattern match and no "everything
 *   except" rule.
 * - It UPDATES rows to empty rather than deleting them. The row, its version
 *   and its audit history survive, the crs_state_audit trigger records the
 *   clearing itself, and nothing depends on a row existing vs being empty.
 * - No DROP, no TRUNCATE, no schema change, and it never touches the `users`,
 *   `payment_*` or `crs_state_audit` tables at all.
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

/**
 * Every store cleared, and why it is transactional. `empty` is the shape the
 * app expects when a store holds nothing — an array store must not become {}.
 */
const CLEAR = [
  { key: 'entryStore', empty: {}, why: 'Daily Sales sheets — and the remittances recorded on them' },
  { key: 'inspectionStore', empty: {}, why: 'Inspection adjustments, keyed by shop and date' },
  { key: 'monthlyStore', empty: {}, why: 'Published monthly figures (derived from the above)' },
  { key: 'meManualStore', empty: {}, why: 'Hand-keyed Monthly Entry figures' },
  { key: 'meSourceStore', empty: {}, why: 'Per-commodity source flags (derived)' },
  { key: 'meRemitStore', empty: {}, why: 'Monthly Remittance — SRCB, per month' },
  { key: 'meGunnyStore', empty: {}, why: 'Gunny / Poly / C.Box stock per month' },
  { key: 'meCardStore', empty: {}, why: 'Card counts per month (the card TYPES are in code, untouched)' },
  { key: 'meAllotStore', empty: {}, why: 'Allotment quantities per month (the allotment RULES are in code)' },
  { key: 'meAdvanceStore', empty: {}, why: 'Advance figures per month' },
  { key: 'meCardConfirmed', empty: {}, why: 'Per-month "card details confirmed" flags' },
  { key: 'salesCloseStore', empty: {}, why: 'Sales Close marks, per month' },
  { key: 'receiptStore', empty: [], why: 'Godown receipt register (an ARRAY store)' },
  { key: '__clearRequests', empty: { seq: 0, requests: [], events: [] }, why: 'Clear-approval requests and their history' },
];

/**
 * Named so a reader can see they were considered and deliberately spared.
 * Editing this list is not enough to clear them — they are not in CLEAR.
 */
const KEEP = [
  ['__shops', 'CRS shop master — numbers and Tamil names'],
  ['__crsMaster', 'CRS Master: BC/packer, COLL, police, usage status'],
  ['__commodities', 'Commodity id list'],
  ['__commodityMaster', 'Commodity master with rates'],
  ['__config', 'Organisation, region, account labels'],
  ['__accounts', 'Per-shop cereal account numbers'],
  ['__holidays', 'Government holiday calendar'],
  ['__pvOfficers', 'PV Officer groups, names and visit dates'],
  ['__counters', 'AMBIGUOUS — next-id pointers for receipts/monthly. Left alone.'],
  ['userStore__pre_0002', 'Pre-migration staff roster. User data — left alone.'],
];

const write = process.argv.includes('--write');
const allowed = new Set(CLEAR.map((c) => c.key));

const { data: rows, error } = await db.from('crs_state').select('store_key, data, version');
if (error) {
  console.error(error.message);
  process.exit(1);
}
const byKey = new Map(rows.map((r) => [r.store_key, r]));
const count = (d) => (Array.isArray(d) ? d.length : d && typeof d === 'object' ? Object.keys(d).length : 0);

console.log(write ? '── CLEARING ──\n' : '── DRY RUN — nothing will be written. Pass --write to apply. ──\n');
console.log('WILL CLEAR');
let total = 0;
for (const c of CLEAR) {
  const row = byKey.get(c.key);
  const n = row ? count(row.data) : 0;
  total += n;
  console.log(`  ${c.key.padEnd(20)} ${String(n).padStart(4)} record(s)   ${row ? '' : '(no row — nothing to do)'}`);
}
console.log(`\n  ${total} records in ${CLEAR.length} stores\n`);
console.log('WILL NOT TOUCH');
for (const [k, why] of KEEP) {
  const row = byKey.get(k);
  console.log(`  ${k.padEnd(20)} ${String(row ? count(row.data) : 0).padStart(4)} record(s)   ${why}`);
}
console.log('\n  Tables never opened by this script: users, payment_orders, payment_settings, crs_state_audit\n');

if (!write) process.exit(0);

let ok = 0;
for (const c of CLEAR) {
  if (!allowed.has(c.key)) throw new Error(`refusing ${c.key}: not in the allowlist`);
  const row = byKey.get(c.key);
  if (!row) {
    console.log(`skip  ${c.key} (no row)`);
    continue;
  }
  const { data, error: e } = await db
    .from('crs_state')
    .update({ data: c.empty, version: row.version + 1, updated_at: new Date().toISOString(), updated_by: 'cleanup:fresh-start' })
    .eq('scope', 'global')
    .eq('store_key', c.key)
    .eq('version', row.version)
    .select('version')
    .maybeSingle();
  if (e || !data) console.log(`FAIL  ${c.key}: ${e?.message ?? 'version changed while running — re-run'}`);
  else {
    ok++;
    console.log(`ok    ${c.key} cleared (v${row.version} → v${data.version})`);
  }
}
console.log(`\n${ok}/${CLEAR.length} stores cleared.`);
