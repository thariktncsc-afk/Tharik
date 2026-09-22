/**
 * Swap two commodities' Opening on a shop's first day sheet — an Initial
 * Opening keyed into each other's box.
 *
 *   node tools/swap-opening.mjs --crs=10 --date=2026-09-01 --a=PHH_BRA --b=PHH_FRK            dry run
 *   node tools/swap-opening.mjs --crs=10 --date=2026-09-01 --a=PHH_BRA --b=PHH_FRK --write    apply
 *
 * Written for CRS 10 (office, 2026-09-22): its PHH BRA and PHH FRK Initial
 * Openings were keyed the wrong way round.
 *
 * What moves: the two Opening figures trade places, and each row's Total and
 * Closing move by the same amount — they are Opening + Receipt ± adjustments
 * and Total − Sales, so nothing else keyed on the row (receipts, sales,
 * adjustments) changes. Both Openings stay marked `openFixed`, as the admin's
 * Initial Opening was saved.
 *
 * Then exactly what a Daily Entry save does: the month is rebuilt from the day
 * sheets (`rebuildMonthlyFromDaily` → monthlyStore / meSourceStore) and the
 * chain is rebuilt from that date (`rechainAndRepublish`), so every later day
 * carries the corrected Closing. Monthly Entry, the Dashboard's closing stock,
 * the DSS and every statement read those.
 *
 * Refuses unless the date is the shop's chain start (a carried Opening is not
 * the shop's to swap) and both rows exist. Only records of this shop may
 * change — checked before anything is written. Backup to backups/ first,
 * written under each row's version, rolled back on any failure.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

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
const { rechainAndRepublish } = await import(pathToFileURL(join(root, 'src/lib/engine/rechain.ts')).href);
const { rebuildMonthlyFromDaily } = await import(pathToFileURL(join(root, 'src/lib/engine/monthlyRollup.ts')).href);

readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const crs = Number(arg('crs'));
const date = arg('date');
const A = arg('a');
const B = arg('b');
const write = process.argv.includes('--write');

const STORES = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'meSourceStore', 'monthlyStore'];
const WRITABLE = ['entryStore', 'meSourceStore', 'monthlyStore'];
const canon = (v) =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a, b) => canon(a) === canon(b);
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

async function main() {
  if (!(crs >= 1 && crs <= 30) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !A || !B || A === B) {
    console.error('Usage: node tools/swap-opening.mjs --crs=N --date=YYYY-MM-DD --a=ID --b=ID [--write]');
    return 2;
  }
  const { data, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global').in('store_key', STORES);
  if (error) {
    console.error('Could not read crs_state:', error.message);
    return 1;
  }
  const rows = Object.fromEntries((data ?? []).map((r) => [r.store_key, { data: r.data, version: Number(r.version) }]));
  const original = Object.fromEntries(STORES.map((k) => [k, rows[k]?.data ?? (k === 'receiptStore' ? [] : {})]));
  let stores = JSON.parse(JSON.stringify(original));

  const key = `${crs}_${date}`;
  const sheet = stores.entryStore[key];
  if (!sheet) return fail(`No day sheet ${key}.`);
  const earlier = Object.keys(stores.entryStore).filter((k) => k.startsWith(`${crs}_`) && k.slice(String(crs).length + 1) < date);
  if (earlier.length) return fail(`${date} is not CRS ${crs}'s first day (earlier: ${earlier.sort().join(', ')}) — its Opening is carried, not keyed.`);
  const sec = sheet.a?.[A] && sheet.a?.[B] ? 'a' : sheet.b?.[A] && sheet.b?.[B] ? 'b' : null;
  if (!sec) return fail(`${A} and ${B} are not both on ${key} in one section.`);

  const [y, m] = date.split('-').map(Number);
  const mKey = `${crs}_${m}_${y}`;

  // The month rebuild must reproduce what is stored today before it is
  // trusted to write the corrected month.
  const control = rebuildMonthlyFromDaily(crs, m, y, stores.entryStore, stores.inspectionStore, stores.meManualStore[mKey], undefined, stores.receiptStore);
  if (!same(control.merged, stores.monthlyStore[mKey])) {
    return fail(`Rebuilding ${mKey} from the unchanged day sheets does not reproduce the stored month — refusing to write a month this tool cannot reproduce.`);
  }
  console.log(`control: rebuilding ${mKey} from today's day sheets reproduces the stored month exactly`);

  // ── The swap ───────────────────────────────────────────────────────────
  const ra = sheet[sec][A];
  const rb = sheet[sec][B];
  const shift = (row, open) => {
    const d = Number(open) - Number(row.open ?? 0);
    return { ...row, open: r3(open), total: r3(Number(row.total ?? 0) + d), close: r3(Number(row.close ?? 0) + d), openFixed: true };
  };
  const na = shift(ra, rb.open);
  const nb = shift(rb, ra.open);
  const nextSheet = { ...sheet, [sec]: { ...sheet[sec], [A]: na, [B]: nb } };
  stores.entryStore = { ...stores.entryStore, [key]: nextSheet };

  console.log(write ? '── SWAPPING ──' : '── DRY RUN — nothing will be written. Pass --write to apply. ──');
  for (const [id, was, now] of [[A, ra, na], [B, rb, nb]]) {
    const arith = r3(Number(now.open) + Number(now.receipt ?? 0) + Number(now.excess ?? 0) - Number(now.shortage ?? 0)) === r3(now.total) && r3(Number(now.total) - Number(now.sales ?? 0)) === r3(now.close);
    console.log(`  ${date} ${sec}:${id.padEnd(8)} open ${was.open} → ${now.open}  total ${was.total} → ${now.total}  close ${was.close} → ${now.close}  [receipt ${now.receipt ?? 0}, sales ${now.sales ?? 0} kept]  arithmetic ${arith ? 'ok' : 'CHECK'}`);
  }

  // ── The month, as a Daily Entry save republishes it ────────────────────
  const month = rebuildMonthlyFromDaily(crs, m, y, stores.entryStore, stores.inspectionStore, stores.meManualStore[mKey], undefined, stores.receiptStore);
  stores.monthlyStore = { ...stores.monthlyStore, [mKey]: month.merged };
  stores.meSourceStore = { ...stores.meSourceStore, [mKey]: month.source };
  for (const id of [A, B]) {
    const w = original.monthlyStore[mKey]?.[sec]?.[id] ?? {};
    const r = month.merged[sec][id] ?? {};
    const bits = Object.keys({ ...w, ...r }).filter((f) => !same(w[f], r[f])).map((f) => `${f} ${w[f]} → ${r[f]}`);
    console.log(`  month ${mKey} ${sec}:${id.padEnd(8)} ${bits.join('  ') || 'unchanged'}`);
  }

  // ── Every later day re-carried from the corrected Closing ──────────────
  const { patch, dates } = rechainAndRepublish(stores, crs, date);
  if (dates.length) console.log(`  chain rebuilt for ${dates.length} later day(s): ${dates.join(', ')}`);
  else console.log('  chain: no later day sheets to re-carry');
  stores = { ...stores, ...patch };

  // ── Nothing outside this shop may have moved ───────────────────────────
  for (const k of WRITABLE) {
    const before = original[k] ?? {};
    const after = stores[k] ?? {};
    for (const rk of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!same(before[rk], after[rk]) && !rk.startsWith(`${crs}_`)) return fail(`${k}.${rk} would change — it is not CRS ${crs}'s. Nothing written.`);
    }
  }
  const changed = WRITABLE.filter((k) => !same(stores[k], original[k]));
  console.log(`stores to write: ${changed.join(', ') || 'none'} (CRS ${crs} records only)`);
  if (!write || !changed.length) return 0;

  mkdirSync(join(root, 'backups'), { recursive: true });
  const backupFile = join(root, 'backups', `swap-opening-crs${crs}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(backupFile, JSON.stringify(Object.fromEntries(changed.map((k) => [k, rows[k] ?? null])), null, 1));
  console.log(`backup: ${backupFile}`);

  const done = [];
  try {
    for (const k of changed) {
      const row = rows[k];
      if (!row) throw new Error(`${k} has no row to update`);
      const { data: upd, error: e } = await db
        .from('crs_state')
        .update({ data: stores[k], version: row.version + 1, updated_at: new Date().toISOString(), updated_by: 'swap-opening' })
        .eq('scope', 'global')
        .eq('store_key', k)
        .eq('version', row.version)
        .select('version')
        .maybeSingle();
      if (e) throw new Error(`${k}: ${e.message}`);
      if (!upd) throw new Error(`${k} changed while this was running — run it again.`);
      done.push({ key: k, version: Number(upd.version) });
      console.log(`wrote ${k} (v${row.version} → v${upd.version})`);
    }
  } catch (err) {
    console.error(`FAILED: ${err.message}\nputting back what was written…`);
    for (const d of done.reverse()) {
      await db
        .from('crs_state')
        .update({ data: rows[d.key].data, version: d.version + 1, updated_at: new Date().toISOString(), updated_by: 'swap-opening (rollback)' })
        .eq('scope', 'global')
        .eq('store_key', d.key)
        .eq('version', d.version);
      console.error(`restored ${d.key}`);
    }
    return 1;
  }

  const { error: logErr } = await db.from('activity_log').insert({
    actor_username: 'system', actor_name: 'Opening correction', actor_role: 'SYSTEM', source: 'system',
    crs_id: crs, module: 'Daily Sales', action: 'updated', entry_date: date, record_key: key,
    summary: `Admin correction — Initial Opening of ${A} and ${B} swapped (keyed into each other's box): ${ra.open} ↔ ${rb.open}`,
  });
  if (logErr) console.log('activity log not updated — crs_state_audit still records every write');
  return 0;
}

function fail(msg) {
  console.error(msg);
  return 1;
}

process.exitCode = await main();
