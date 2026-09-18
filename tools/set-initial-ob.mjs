/**
 * Enter a shop's Initial Opening Balance on the office's instruction — exactly
 * what a Daily Entry save of that first day would write, and nothing more.
 *
 *   node tools/set-initial-ob.mjs --file=<ob.json>            dry run
 *   node tools/set-initial-ob.mjs --file=<ob.json> --write    apply
 *
 * ob.json:
 *   { "crsId": 20, "date": "2026-09-01",
 *     "opening": { "BRA": 3594.172, "PHH_BRA": 2938, … },       kilos / litres by commodity id
 *     "gunny":   { "ss50": 874, "poly": 40, "cbox": 1 } }        the month's packing opening
 *
 * WHAT IT WRITES
 *   entryStore[<crs>_<date>]   every commodity the shop's Daily Entry shows;
 *                              Opening as given (0 for the rest), the day's
 *                              register receipt if any, Total, Sales 0,
 *                              Closing — and each row marked as the Initial
 *                              Opening (`openFixed`), as the one-time entry is.
 *                              No remittance: there were no sales.
 *   monthlyStore / meSourceStore   the month republished from it, as a save does
 *   meGunnyStore[<crs>_<m>_<y>]    ss50 / poly / cbox opening (the month's
 *                              Gunny table carries it to the next month)
 *   __stockInit                the shop recorded as started from that date
 *
 * SAFE BY CONSTRUCTION. It refuses if the shop already has a sheet on that date
 * or a Gunny record for that month, or if the shop has already started — an
 * Initial Opening is entered once. Every row it touches is backed up to
 * backups/ first and written under the version it was read at; any failure
 * puts back what was already written. Other shops' records are copied through
 * untouched. One activity-log row per record, marked as a data entry on the
 * office's instruction.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const I = await import(pathToFileURL(join(root, 'src/lib/engine/stockInit.ts')).href);
const G = await import(pathToFileURL(join(root, 'src/lib/stockGuard.ts')).href);
const C = await import(pathToFileURL(join(root, 'src/lib/engine/stockChain.ts')).href);
const MR = await import(pathToFileURL(join(root, 'src/lib/engine/monthlyRollup.ts')).href);
const RR = await import(pathToFileURL(join(root, 'src/lib/engine/receiptRollup.ts')).href);

readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const write = process.argv.includes('--write');
const fileArg = (process.argv.find((a) => a.startsWith('--file=')) ?? '').slice(7);
const kg = (n) => Math.round(n * 1000) / 1000;
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

async function main() {
  if (!fileArg) {
    console.error('Pass --file=<ob.json>');
    return 1;
  }
  const spec = JSON.parse(readFileSync(fileArg, 'utf8'));
  const crsId = Number(spec.crsId);
  const date = String(spec.date);
  if (!(crsId > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('crsId and date (YYYY-MM-DD) are required');
  const [y, m] = date.split('-').map(Number);
  const dayKey = `${crsId}_${date}`;
  const monthKey = `${crsId}_${m}_${y}`;

  const STORES = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'meSourceStore', 'monthlyStore', 'meGunnyStore', I.STOCK_INIT_KEY, '__commodityMaster', '__shops'];
  const { data, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global').in('store_key', STORES);
  if (error) throw error;
  const rows = Object.fromEntries(data.map((r) => [r.store_key, { data: r.data, version: Number(r.version) }]));
  const get = (k, d) => rows[k]?.data ?? d;
  const entry = get('entryStore', {});
  const insp = get('inspectionStore', {});
  const receipts = get('receiptStore', []);
  const gunnyStore = get('meGunnyStore', {});
  const init = I.readStockInit(get(I.STOCK_INIT_KEY, {}));

  // ── Refuse anything that is not a genuine first entry ─────────────────────
  if (entry[dayKey]) throw new Error(`${dayKey} already has a day sheet — not overwriting it.`);
  if (I.isInitialized(init, crsId)) throw new Error(`CRS ${crsId} has already started (${I.initialDate(init, crsId)}) — an Initial Opening is entered once.`);
  const earlier = Object.keys(entry).filter((k) => k.startsWith(`${crsId}_`) && k.slice(k.indexOf('_') + 1) < date);
  if (earlier.length) throw new Error(`CRS ${crsId} has sheets before ${date}: ${earlier.join(', ')}`);
  if (spec.gunny && gunnyStore[monthKey]) throw new Error(`${monthKey} already has a Gunny record — not overwriting it.`);

  // ── The shop's Daily Entry list, as the screen builds it ──────────────────
  const master = get('__commodityMaster', []);
  const section = (sec) => master.filter((c) => c.section === sec && c.active !== false && !c.crs29Only).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (crsId === 29) throw new Error('CRS 29 keys its own list (and Free/Cost Rice) — enter it on Daily Entry.');
  const lists = { a: section('a'), b: section('b') };
  const known = new Map([...lists.a.map((c) => [c.id, 'a']), ...lists.b.map((c) => [c.id, 'b'])]);
  for (const id of Object.keys(spec.opening ?? {})) if (!known.has(id)) throw new Error(`Unknown commodity id ${id}`);

  const register = RR.receiptQtyForDay(receipts, crsId, date);
  const sheet = { a: {}, b: {} };
  for (const [sec, comms] of [['a', lists.a], ['b', lists.b]]) {
    for (const c of comms) {
      const open = kg(Number(spec.opening?.[c.id] ?? 0));
      const receipt = kg(register[c.id] ?? 0);
      const adj = insp[dayKey]?.[sec]?.[c.id] ?? {};
      const excess = Number(adj.excess) || 0;
      const shortage = Number(adj.shortage) || 0;
      const transfer = Number(adj.transfer) || 0;
      const total = kg(open + receipt + excess - shortage - transfer);
      sheet[sec][c.id] = { open, receipt, total, sales: 0, close: total, amount: 0, excess, shortage, transfer, openFixed: true };
    }
  }

  const nextEntry = { ...entry, [dayKey]: sheet };
  // The arithmetic rule binds every writer, administrators included.
  const broken = G.inspectStockWrite({ entryStore: entry, receiptStore: receipts, inspectionStore: insp, [I.STOCK_INIT_KEY]: init }, { entryStore: nextEntry }, true);
  if (broken.length) throw new Error(`Stock guard refused: ${G.describeStock(broken.slice(0, 3))}`);

  // Republish the month as a Daily Entry save does.
  const manual = get('meManualStore', {});
  const { merged, source } = MR.rebuildMonthlyFromDaily(crsId, m, y, nextEntry, insp, manual[monthKey], lists, receipts);
  const nextMonthly = { ...get('monthlyStore', {}), [monthKey]: merged };
  const nextSource = { ...get('meSourceStore', {}), [monthKey]: source };

  const at = new Date().toISOString();
  const labels = { ss50: '50 KG SS', poly: 'POLY', cbox: 'C.BOX' };
  const nextGunny = spec.gunny
    ? {
        ...gunnyStore,
        [monthKey]: Object.fromEntries(
          Object.entries(spec.gunny).map(([id, n]) => [
            id,
            { itemName: labels[id] ?? id, crsId: String(crsId), month: m, year: y, opening: Number(n), openingAuto: false, receipt: 0, total: Number(n), closing: Number(n), createdAt: at, updatedAt: at },
          ]),
        ),
      }
    : gunnyStore;
  const { next: nextInit, changes } = I.reconcileStockInit(init, nextEntry, [crsId], 'admin (office instruction)', at);

  // ── Report ────────────────────────────────────────────────────────────────
  const names = new Map(master.map((c) => [c.id, `${c.en} (${c.unit})`]));
  console.log(`CRS ${crsId} — Initial Opening Balance on ${date.split('-').reverse().join('-')}`);
  for (const [sec, comms] of [['a', lists.a], ['b', lists.b]]) {
    for (const c of comms) {
      const r = sheet[sec][c.id];
      if (r.open || r.receipt) console.log(`  ${names.get(c.id).padEnd(26)} OB ${String(r.open).padStart(10)}  receipt ${r.receipt}  total ${r.total}  CB ${r.close}`);
    }
  }
  console.log(`  (${lists.a.length + lists.b.length} rows on the sheet; the rest open at 0)`);
  if (spec.gunny) console.log(`  Gunny ${m}/${y}: ${Object.entries(spec.gunny).map(([id, n]) => `${labels[id] ?? id} ${n}`).join(', ')}`);
  console.log(`  started record: ${changes.map((c) => `${c.from ?? 'not started'} → ${c.to}`).join(', ') || 'unchanged'}`);
  const ix = C.buildChainIndex(nextEntry, insp, receipts, crsId);
  const nextDay = new Date(Date.UTC(y, m - 1, Number(date.slice(8)) + 1)).toISOString().slice(0, 10);
  console.log(`  carry into ${nextDay}: BRA ${C.openingFor(ix, nextDay, 'BRA', 'a').value}, SUGAR ${C.openingFor(ix, nextDay, 'SUGAR', 'a').value}, PALM ${C.openingFor(ix, nextDay, 'PALM', 'a').value}`);

  const plan = [
    ['entryStore', nextEntry],
    ['monthlyStore', nextMonthly],
    ['meSourceStore', nextSource],
    ['meGunnyStore', nextGunny],
    [I.STOCK_INIT_KEY, nextInit],
  ].filter(([k, v]) => canon(v) !== canon(get(k, undefined)));
  console.log(`\nstores to write: ${plan.map(([k]) => k).join(', ')}`);
  if (!write) {
    console.log('DRY RUN — pass --write to apply.');
    return 0;
  }

  // ── Backup, then write under version, rolling back on any failure ─────────
  mkdirSync(join(root, 'backups'), { recursive: true });
  const backup = join(root, 'backups', `initial-ob-crs${crsId}-${at.replace(/[:.]/g, '-')}.json`);
  writeFileSync(backup, JSON.stringify(Object.fromEntries(plan.map(([k]) => [k, rows[k] ?? null])), null, 1));
  console.log(`backup: ${backup}`);
  const done = [];
  try {
    for (const [key, value] of plan) {
      const row = rows[key];
      if (!row) {
        const { error: e } = await db.from('crs_state').insert({ scope: 'global', store_key: key, data: value, version: 1, updated_by: 'initial-ob:office' });
        if (e) throw new Error(`${key}: ${e.message}`);
        done.push({ key, version: 1, created: true });
      } else {
        const { data: upd, error: e } = await db
          .from('crs_state')
          .update({ data: value, version: row.version + 1, updated_at: new Date().toISOString(), updated_by: 'initial-ob:office' })
          .eq('scope', 'global')
          .eq('store_key', key)
          .eq('version', row.version)
          .select('version')
          .maybeSingle();
        if (e) throw new Error(`${key}: ${e.message}`);
        if (!upd) throw new Error(`${key} changed while this ran (someone saved) — nothing kept; run it again.`);
        done.push({ key, version: Number(upd.version) });
      }
      console.log(`wrote ${key}`);
    }
  } catch (err) {
    console.error(`FAILED: ${err.message}\nputting back what was written…`);
    for (const d of done.reverse()) {
      if (d.created) continue; // a brand-new row holds only this entry's data
      await db.from('crs_state').update({ data: rows[d.key].data, version: d.version + 1, updated_at: new Date().toISOString(), updated_by: 'initial-ob:office (rollback)' }).eq('scope', 'global').eq('store_key', d.key).eq('version', d.version);
      console.error(`restored ${d.key}`);
    }
    return 1;
  }

  // The activity log: what was entered, and on whose instruction.
  const shopName = get('__shops', [])[crsId - 1]?.name ?? '';
  const who = { actor_user_id: null, actor_username: 'initial-ob:office', actor_name: 'Administrator (office instruction)', actor_role: 'ADMIN', source: 'user', crs_id: crsId, shop_name: shopName };
  const changesOf = (sec) => Object.entries(sheet[sec]).filter(([, r]) => r.open).map(([id, r]) => ({ label: `${names.get(id)} · Opening`, before: '—', after: String(r.open) }));
  const { error: logErr } = await db.from('activity_log').insert([
    { ...who, module: 'Daily Sales', action: 'created', entry_date: date, record_key: dayKey, summary: `Initial Opening Balance entered for ${date.split('-').reverse().join('-')} on the office's instruction`, changes: [...changesOf('a'), ...changesOf('b')] },
    ...(spec.gunny ? [{ ...who, module: 'Gunny', action: 'created', entry_month: m, entry_year: y, record_key: monthKey, summary: `Gunny opening for ${m}/${y} entered on the office's instruction`, changes: Object.entries(spec.gunny).map(([id, n]) => ({ label: `${labels[id] ?? id} · Opening`, before: '—', after: String(n) })) }] : []),
  ]);
  if (logErr) console.log(`activity log not written: ${logErr.message}`);
  console.log('\nDONE');
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
