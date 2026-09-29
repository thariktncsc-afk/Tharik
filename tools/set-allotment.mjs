/**
 * Save shops' ALLOTMENT for one month in the live database, from the
 * department's FPS Allocation Report — what Monthly Entry's "Save Allotment"
 * does, for each shop named.
 *
 *   node tools/set-allotment.mjs --month=9 --year=2026 --data=<file.json>           dry run
 *   node tools/set-allotment.mjs --month=9 --year=2026 --data=<file.json> --write   apply
 *
 * <file.json>: { "<crsId>": { "fps": "22EA001PN", "BRA": 5817.535, … }, … }
 * Each shop's record is REPLACED by exactly the figures given (0 included —
 * a saved month prints 0 for a commodity not allotted), and its month gets
 * the saved mark in meAllotConfirmed, as Save Allotment sets it.
 *
 * Safety, before anything is written:
 *  - every commodity id must be one Allotment shows (Section A, not the
 *    packet / packing lines) — police lines have no Allotment field;
 *  - "fps" must be the shop's code in __crsMaster, so one shop's row can
 *    never land on another shop;
 *  - only the named shops' <crs>_<month>_<year> keys may change; a key that
 *    already holds different figures is listed and needs --replace;
 *  - both rows are backed up to backups/ and written under their version.
 * A re-run with the same figures writes nothing.
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

// What Allotment lists (masters.ts useAllotItems: Section A less these).
const NOT_ALLOTTED = new Set(['SALT_CIS', 'SALT_RFFS', 'OOTY', 'TAN', 'EMPTY_BOX', 'EMPTY_BAG']);
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const month = Number(arg('month'));
  const year = Number(arg('year'));
  const dataFile = arg('data');
  const write = process.argv.includes('--write');
  const replace = process.argv.includes('--replace');
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020 || !dataFile) {
    console.error('Usage: node tools/set-allotment.mjs --month=<1-12> --year=<yyyy> --data=<file.json> [--replace] [--write]');
    return 2;
  }
  const input = JSON.parse(readFileSync(resolve(dataFile), 'utf8'));

  const read = async (storeKey) => {
    const { data, error } = await db.from('crs_state').select('data, version').eq('scope', 'global').eq('store_key', storeKey).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`${storeKey} row missing in crs_state — not creating stores from a tool.`);
    return data;
  };
  const [allot, confirmed, master, commodities] = await Promise.all([read('meAllotStore'), read('meAllotConfirmed'), read('__crsMaster'), read('__commodityMaster')]);
  const allotIds = new Set(commodities.data.filter((c) => (c.section ?? 'a') === 'a' && !NOT_ALLOTTED.has(c.id)).map((c) => c.id));

  const problems = [];
  const next = { ...allot.data };
  const nextConfirmed = { ...confirmed.data };
  const keys = [];
  console.log(`meAllotStore v${allot.version} · meAllotConfirmed v${confirmed.version} · ${month}/${year}`);
  for (const [crsText, row] of Object.entries(input)) {
    const crsId = Number(crsText);
    const key = `${crsId}_${month}_${year}`;
    keys.push(key);
    const code = master.data.find((m) => Number(m.id) === crsId)?.code;
    if (!code || code !== row.fps) problems.push(`CRS ${crsId}: report FPS code ${row.fps} ≠ CRS master code ${code ?? '(none)'}`);
    const figures = {};
    for (const [id, v] of Object.entries(row)) {
      if (id === 'fps') continue;
      if (!allotIds.has(id)) problems.push(`CRS ${crsId}: ${id} is not an Allotment field`);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) problems.push(`CRS ${crsId}: ${id} = ${v} is not a quantity`);
      figures[id] = v;
    }
    const had = allot.data[key];
    const same = had && canon(had) === canon(figures);
    if (had && !same && !replace) problems.push(`CRS ${crsId}: ${key} already has a different allotment ${JSON.stringify(had)} — pass --replace to overwrite it`);
    console.log(`  CRS ${String(crsId).padStart(2)} (${code}): ${had ? (same ? 'already so' : 'replace ' + JSON.stringify(had)) : 'new'}`);
    console.log(`        → ${Object.entries(figures).map(([id, v]) => `${id} ${v}`).join(', ')}; saved mark: ${!!confirmed.data[key]} → true`);
    next[key] = figures;
    nextConfirmed[key] = true;
  }
  for (const [name, before, after] of [['meAllotStore', allot.data, next], ['meAllotConfirmed', confirmed.data, nextConfirmed]]) {
    const moved = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => canon(before[k]) !== canon(after[k]));
    const stray = moved.filter((k) => !keys.includes(k));
    if (stray.length) problems.push(`${name} would change ${stray.join(', ')}, which were not asked for`);
    console.log(`  ${name}: ${moved.length ? `changes ${moved.join(', ')}` : 'nothing to change'}; ${Object.keys(before).filter((k) => !keys.includes(k)).length} other key(s) untouched (${Object.keys(before).filter((k) => !keys.includes(k)).join(', ') || 'none'})`);
  }
  if (problems.length) {
    console.error('Refused:\n  ' + problems.join('\n  '));
    return 1;
  }
  const needAllot = canon(next) !== canon(allot.data);
  const needConfirmed = canon(nextConfirmed) !== canon(confirmed.data);
  if (!needAllot && !needConfirmed) {
    console.log('Already saved exactly so — nothing to write.');
    return 0;
  }
  if (!write) {
    console.log('DRY RUN — pass --write to apply.');
    return 0;
  }

  mkdirSync(join(root, 'backups'), { recursive: true });
  const file = join(root, 'backups', `allotment-${month}-${year}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ meAllotStore: allot, meAllotConfirmed: confirmed, input }, null, 1));
  console.log(`Backed up both rows to ${file}`);
  const put = async (storeKey, row, data) => {
    const { data: upd, error } = await db
      .from('crs_state')
      .update({ data, version: Number(row.version) + 1, updated_at: new Date().toISOString(), updated_by: 'set-allotment' })
      .eq('scope', 'global')
      .eq('store_key', storeKey)
      .eq('version', row.version)
      .select('version');
    if (error) throw error;
    if (!upd?.length) throw new Error(`${storeKey} changed since it was read — nothing more written; run it again.`);
    console.log(`WROTE ${storeKey} v${row.version} → v${upd[0].version}`);
  };
  // Figures first, then the saved marks — a mark never stands without its figures.
  if (needAllot) await put('meAllotStore', allot, next);
  if (needConfirmed) await put('meAllotConfirmed', confirmed, nextConfirmed);
  console.log(`Done: ${keys.length} shop(s) saved for ${month}/${year}.`);
  return 0;
}
// Returned, not process.exit(): exiting while the database socket closes trips a
// libuv assertion on Windows (exit 127) even when all went well.
process.exitCode = await main();
