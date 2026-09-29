/**
 * Save ONE shop's Card Details for ONE month in the live database — what
 * Monthly Entry's "Save Card Details" does, for figures the office supplies
 * from the shop's own POS screen.
 *
 *   node tools/set-card-details.mjs --crs=30 --month=9 --year=2026 \
 *     --rice=728 --lof_rice=4 --sugar=13 --lof_sugar=0 --aay=27 --lof_aay=0 \
 *     --oap=0 --police=4 --n_card=1                        dry run
 *   … --write                                              apply (after a backup)
 *
 * All nine cards must be given — a card the POS does not list is 0, said
 * out loud — so the month's TOTAL CARD is exactly the sum of the figures
 * passed; nothing here ever writes a total. Written, as Save Card Details
 * does:
 *   meCardStore['<crs>_<month>_<year>']     = { <card>: { count: n }, … }
 *   meCardConfirmed['<crs>_<month>_<year>'] = true   (the month's "saved" mark)
 * Monthly Entry, CRS Page 1 and every preview / print / PDF read those same
 * records, so they cannot disagree.
 *
 * Only that one key of each store changes: every other shop and month is
 * untouched (the tool checks this before writing). A month that already has
 * counts is refused unless --replace. Both rows are saved to backups/ first
 * and written under their version, so a change made by someone else in
 * between is refused rather than overwritten; crs_state_audit records the
 * writes like any other. Running it again with the same figures writes
 * nothing.
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

// The Monthly Entry card rows, in the screen's order (monthly-entry/lib.ts ME_CARD_TYPES).
const CARDS = [
  ['rice', 'RICE CARD'], ['lof_rice', 'LOF RICE CARD'], ['sugar', 'SUGAR CARD'], ['lof_sugar', 'LOF SUGAR'],
  ['aay', 'AAY CARD'], ['lof_aay', 'LOF AAY CARD'], ['oap', 'OAP'], ['police', 'POLICE'], ['n_card', '"N" CARD'],
];

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const crsId = Number(arg('crs'));
const month = Number(arg('month'));
const year = Number(arg('year'));
const write = process.argv.includes('--write');
const replace = process.argv.includes('--replace');
const usage = () => {
  console.error('Usage: node tools/set-card-details.mjs --crs=<1-30> --month=<1-12> --year=<yyyy> ' + CARDS.map(([id]) => `--${id}=<n>`).join(' ') + ' [--replace] [--write]');
  process.exit(2);
};
if (!Number.isInteger(crsId) || crsId < 1 || crsId > 30 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020) usage();
const counts = {};
for (const [id] of CARDS) {
  const raw = arg(id);
  if (raw === undefined || !/^\d+$/.test(raw)) {
    console.error(`--${id} is missing or not a whole number (${raw ?? 'not given'}).`);
    usage();
  }
  counts[id] = { count: Number(raw) };
}
const key = `${crsId}_${month}_${year}`;
const total = Object.values(counts).reduce((t, c) => t + c.count, 0);

// Returned, not process.exit(): exiting while the database socket closes trips a
// libuv assertion on Windows (exit 127) even when all went well.
async function main() {
  const read = async (storeKey) => {
    const { data, error } = await db.from('crs_state').select('data, version').eq('scope', 'global').eq('store_key', storeKey).maybeSingle();
    if (error) throw error;
    return data ?? { data: {}, version: 0, missing: true };
  };
  const cards = await read('meCardStore');
  const confirmed = await read('meCardConfirmed');
  if (cards.missing || confirmed.missing) {
    console.error('meCardStore / meCardConfirmed row missing in crs_state — not creating stores from a tool.');
    return 1;
  }

  const had = cards.data[key];
  console.log(`meCardStore v${cards.version} · meCardConfirmed v${confirmed.version} · CRS ${crsId}, ${month}/${year} (key ${key})`);
  console.log(`  now:  ${had ? CARDS.map(([id, l]) => `${l} ${had[id]?.count ?? '—'}`).join(', ') : 'no card details saved'}; saved mark: ${!!confirmed.data[key]}`);
  console.log(`  new:  ${CARDS.map(([id, l]) => `${l} ${counts[id].count}`).join(', ')}`);
  console.log(`  TOTAL CARD = ${CARDS.map(([id]) => counts[id].count).join(' + ')} = ${total}; saved mark: true`);

  const same = had && CARDS.every(([id]) => Number(had[id]?.count) === counts[id].count) && Object.keys(had).length === CARDS.length;
  if (had && !same && !replace) {
    console.error(`Refused: ${key} already has card details. Pass --replace to overwrite them (the row is backed up first).`);
    return 1;
  }

  const nextCards = { ...cards.data, [key]: counts };
  const nextConfirmed = { ...confirmed.data, [key]: true };
  // Nothing but this key may change. Compared with keys sorted: the database
  // hands JSONB back in its own key order, which is not a change.
  const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  for (const [name, before, after] of [['meCardStore', cards.data, nextCards], ['meCardConfirmed', confirmed.data, nextConfirmed]]) {
    const moved = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => canon(before[k]) !== canon(after[k]));
    if (moved.some((k) => k !== key)) {
      console.error(`Refused: ${name} would change ${moved.join(', ')} — only ${key} may.`);
      return 1;
    }
    console.log(`  ${name}: ${moved.length ? `changes ${moved.join(', ')} only` : 'already as asked — nothing to write'}; ${Object.keys(before).length} other key(s) untouched`);
  }
  const needCards = !same;
  const needConfirmed = !confirmed.data[key];
  if (!needCards && !needConfirmed) {
    console.log('Already saved exactly so — nothing to write.');
    return 0;
  }
  if (!write) {
    console.log('DRY RUN — pass --write to apply.');
    return 0;
  }

  mkdirSync(join(root, 'backups'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(root, 'backups', `card-details-crs${crsId}-${month}-${year}-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ meCardStore: cards, meCardConfirmed: confirmed }, null, 1));
  console.log(`Backed up both rows to ${file}`);

  const put = async (storeKey, row, data) => {
    const { data: upd, error } = await db
      .from('crs_state')
      .update({ data, version: Number(row.version) + 1, updated_at: new Date().toISOString(), updated_by: 'set-card-details' })
      .eq('scope', 'global')
      .eq('store_key', storeKey)
      .eq('version', row.version)
      .select('version');
    if (error) throw error;
    if (!upd?.length) {
      console.error(`Refused: ${storeKey} changed since it was read. Nothing more was written — run it again (it only writes what is still missing).`);
      return 1;
    }
    console.log(`WROTE ${storeKey} v${row.version} → v${upd[0].version}`);
  };
  // Counts first, then the saved mark — a mark never stands without its counts.
  if (needCards) await put('meCardStore', cards, nextCards);
  if (needConfirmed) await put('meCardConfirmed', confirmed, nextConfirmed);
  console.log(`Done: CRS ${crsId} ${month}/${year} Card Details saved — TOTAL CARD ${total}.`);

  return 0;
}
process.exitCode = await main();
