/**
 * Set one shop's Police flag in the live CRS master (`__crsMaster[].police`).
 *
 *   node tools/set-crs-police.mjs --crs=12 --on            dry run: show the change
 *   node tools/set-crs-police.mjs --crs=12 --on --write    apply (after a backup)
 *   node tools/set-crs-police.mjs --crs=12 --off --write   take it away again
 *
 * The CRS Master screen shows the flag but cannot change it, and the office
 * assigns police ration to a shop from time to time (CRS 12, 2026-09-22). The
 * flag is read by the CRS Master screen, the dashboard's shop card
 * ("Had Police") and the COLL statement's POLICE block; Daily and Monthly
 * Entry show Section B for every shop regardless.
 *
 * Exactly one field of one shop is written. The whole row is saved to
 * backups/ first and written under its version, so a change made by someone
 * else in between is refused rather than overwritten. crs_state_audit records
 * the write like any other.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const { createClient } = createRequire(join(root, 'package.json'))('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const crsId = Number(arg('crs'));
const on = process.argv.includes('--on');
const off = process.argv.includes('--off');
const write = process.argv.includes('--write');
if (!Number.isInteger(crsId) || crsId < 1 || crsId > 30 || on === off) {
  console.error('Usage: node tools/set-crs-police.mjs --crs=<1-30> --on|--off [--write]');
  process.exit(2);
}

const { data: row, error } = await db.from('crs_state').select('data, version').eq('scope', 'global').eq('store_key', '__crsMaster').maybeSingle();
if (error) throw error;
if (!row || !Array.isArray(row.data)) {
  console.error('No __crsMaster row in crs_state — nothing to change.');
  process.exit(1);
}
const rec = row.data.find((r) => Number(r.id) === crsId);
if (!rec) {
  console.error(`CRS ${crsId} is not in __crsMaster.`);
  process.exit(1);
}

const before = !!rec.police;
console.log(`__crsMaster v${row.version} · CRS ${crsId} (${rec.code || 'no code'}) · police: ${before} → ${on}`);
if (before === on) {
  console.log('Already set — nothing to write.');
  process.exit(0);
}
const next = row.data.map((r) => (Number(r.id) === crsId ? { ...r, police: on } : r));
const changed = next.filter((r, i) => JSON.stringify(r) !== JSON.stringify(row.data[i]));
console.log(`Records changed: ${changed.length} (CRS ${changed.map((r) => r.id).join(', ')}); every other shop untouched.`);
if (!write) {
  console.log('DRY RUN — pass --write to apply.');
  process.exit(0);
}

mkdirSync(join(root, 'backups'), { recursive: true });
const file = join(root, 'backups', `crs-master-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(row, null, 1));
console.log(`Backed up to ${file}`);

const { data: upd, error: e2 } = await db
  .from('crs_state')
  .update({ data: next, version: Number(row.version) + 1, updated_at: new Date().toISOString(), updated_by: 'set-crs-police' })
  .eq('scope', 'global')
  .eq('store_key', '__crsMaster')
  .eq('version', row.version)
  .select('version');
if (e2) throw e2;
if (!upd?.length) {
  console.error('Refused: __crsMaster changed since it was read. Nothing was written — run it again.');
  process.exit(1);
}
console.log(`WROTE __crsMaster v${row.version} → v${upd[0].version}: CRS ${crsId} police = ${on}`);
