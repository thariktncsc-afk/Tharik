/**
 * Daily Entry's "Last Entry Date | Total Entry Dates" (office, 2026-09-28).
 *
 *   node tools/verify-entry-dates.mjs
 *
 * 1. The rule (engine/entryDates.ts): a date counts once, only for a real
 *    saved day sheet — not a blank one, not a Monthly Entry projection, not
 *    another shop's.
 * 2. SAVED, not typed: the page reads dataStore's saved copy. Driven against a
 *    stand-in /api/state: a sheet still unsaved does not count, a save that
 *    lands does at once, a refused one never does, and an approved clear
 *    removing a day elsewhere takes it off on the next beat.
 * 3. Live data, read only (if .env.local is here): every shop, checked against
 *    an independent count written from scratch below.
 */
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
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

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const J = (v) => JSON.stringify(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

const realFetch = globalThis.fetch;
const E = await import(pathToFileURL(join(root, 'src/lib/engine/entryDates.ts')).href);

console.log('\n1. What counts as an entry date');
{
  const day = (sales, extra = {}) => ({ a: { BRA: { open: 0, sales }, SUGAR: { open: 0, sales } }, ...extra });
  const store = {
    '19_2026-09-01': day(10),
    '19_2026-09-02': day(10),
    '19_2026-09-03': day(10),
    '19_2026-09-05': day(10),
    '19_2026-09-08': day(10),
    '19_2026-09-10': day(10),
    '19_2026-09-15': day(10),
    '19_2026-09-19': { a: { BRA: { open: 1783.014, receipt: 0, sales: 0, close: 1783.014 } } }, // no sales, but stock
    '19_2026-09-21': { a: { BRA: { open: 0, receipt: 0, sales: 0 } }, b: {} }, // emptied and saved
    '19_2026-09-30': { __projection: true, a: { BRA: { open: 5, sales: 5 } } }, // Monthly Entry's month-end sheet
    '19_notes': { a: { BRA: { sales: 1 } } }, // not a date key
    '1_2026-09-25': day(3), // another shop
    '190_2026-09-26': day(3), // another shop whose number starts with 19
  };
  const s = E.entrySummary(store, 19);
  check('the office\'s example: 1, 2, 3, 5, 8, 10, 15, 19 September → 8 dates, last 19-09-2026',
    s.count === 8 && s.last === '2026-09-19' && E.ddmmyyyy(s.last) === '19-09-2026', J(s));
  check('a date with many commodities counts once', E.entrySummary({ '7_2026-09-16': day(1) }, 7).count === 1);
  check('a sheet emptied and saved (all zero) is not an entry', !E.isDailyEntry(store['19_2026-09-21']));
  check('a Monthly Entry projection is not a Daily Entry', !E.isDailyEntry(store['19_2026-09-30']));
  check('CRS 1 and CRS 190 do not leak into CRS 19 (and CRS 19 not into CRS 1)', E.entrySummary(store, 1).count === 1 && E.entrySummary(store, 190).count === 1);
  check('the latest date is the latest, whatever order the keys are in',
    E.entrySummary({ '4_2026-09-20': day(1), '4_2026-08-31': day(1), '4_2026-09-02': day(1) }, 4).last === '2026-09-20');
  check('a shop with nothing: no last date, 0', J(E.entrySummary(store, 2)) === J({ last: null, count: 0 }) && J(E.entrySummary(undefined, 2)) === J({ last: null, count: 0 }));
}

console.log('\n2. Saved, not typed (the data layer against a stand-in server)');
{
  const server = {
    rows: { entryStore: { data: { '19_2026-09-19': { a: { BRA: { sales: 4 } } } }, version: 3 } },
    refuse: false,
  };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://local');
    const method = init.method ?? 'GET';
    if (u.pathname === '/api/users') return json(200, { users: [] });
    if (u.pathname === '/api/sync') return json(200, { versions: Object.fromEntries(Object.entries(server.rows).map(([k, r]) => [k, r.version])), clears: 0 });
    if (u.pathname === '/api/state' && method === 'GET') {
      const keys = (u.searchParams.get('keys') ?? '').split(',').filter(Boolean);
      const stores = {}, versions = {};
      for (const [k, r] of Object.entries(server.rows)) if (!keys.length || keys.includes(k)) { stores[k] = clone(r.data); versions[k] = r.version; }
      return json(200, { stores, versions });
    }
    if (u.pathname === '/api/state' && method === 'POST') {
      if (server.refuse) return json(403, { error: 'Opening lock' });
      const body = JSON.parse(init.body);
      const saved = {};
      for (const [k, v] of Object.entries(body.stores)) { server.rows[k] = { data: clone(v), version: Number(body.versions[k] ?? 0) + 1 }; saved[k] = server.rows[k].version; }
      return json(200, { ok: true, versions: saved });
    }
    return json(404, {});
  };
  const { crsData } = await import(pathToFileURL(join(root, 'src/lib/dataStore.ts')).href);
  let emits = 0;
  crsData.subscribe(() => emits++);
  await crsData.load();
  const saved = () => E.entrySummary(crsData.getSaved('entryStore'), 19);
  check('on load: what the database holds (19-09, 1 date)', J(saved()) === J({ last: '2026-09-19', count: 1 }), J(saved()));
  check('the saved copy is one stable object between changes (no re-render churn)', crsData.getSaved('entryStore') === crsData.getSaved('entryStore'));

  crsData.update('entryStore', (d) => { d['19_2026-09-20'] = { a: { BRA: { sales: 6 } } }; });
  check('typed but not yet saved: NOT counted', J(saved()) === J({ last: '2026-09-19', count: 1 }), J(saved()));

  const before = emits;
  check('the save lands…', (await crsData.save()) === true);
  check('…and at once: last 20-09, 2 dates, and the screen is told', J(saved()) === J({ last: '2026-09-20', count: 2 }) && emits > before, J(saved()));

  server.refuse = true;
  crsData.update('entryStore', (d) => { d['19_2026-09-22'] = { a: { BRA: { sales: 2 } } }; });
  await crsData.save();
  check('a save the server REFUSES never counts', J(saved()) === J({ last: '2026-09-20', count: 2 }), J(saved()));
  server.refuse = false;

  // An approved clear, executed on the server, removes 20-09.
  server.rows.entryStore = { data: (({ ['19_2026-09-20']: _, ...rest }) => rest)(clone(server.rows.entryStore.data)), version: server.rows.entryStore.version + 1 };
  await crsData.poll();
  check('an approved clear elsewhere: 20-09 off on the next beat, back to 19-09, 1 date', J(saved()) === J({ last: '2026-09-19', count: 1 }), J(saved()));
}

console.log('\n3. Live data, read only — every shop, against an independent count');
globalThis.fetch = realFetch; // section 2 stood in for the server
if (!existsSync(join(root, '.env.local'))) console.log('  skip  no .env.local here');
else {
  readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); });
  const { createClient } = await import(pathToFileURL(join(root, 'node_modules/@supabase/supabase-js/dist/index.mjs')).href);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.from('crs_state').select('data').eq('store_key', 'entryStore').maybeSingle();
  if (error || !data) console.log(`  skip  could not read entryStore (${error?.message ?? 'none'})`);
  else {
    const es = data.data ?? {};
    // Written from scratch: any non-zero number anywhere in the sheet's two
    // sections, the sheet not a projection, the key "<crs>_<yyyy-mm-dd>".
    const independent = (crs) => {
      const dates = new Set();
      for (const [k, v] of Object.entries(es)) {
        const m = /^(\d+)_(\d{4}-\d{2}-\d{2})$/.exec(k);
        if (!m || Number(m[1]) !== crs || !v || v.__projection) continue;
        const nums = [v.a, v.b].flatMap((sec) => Object.values(sec ?? {})).flatMap((row) => ['open', 'receipt', 'sales', 'total', 'close', 'excess', 'shortage', 'transfer'].map((f) => Number(row?.[f])));
        if (nums.some((n) => Number.isFinite(n) && n !== 0)) dates.add(m[2]);
      }
      const sorted = [...dates].sort();
      return { last: sorted.at(-1) ?? null, count: sorted.length };
    };
    const rows = [];
    let agree = 0;
    for (let crs = 1; crs <= 30; crs++) {
      const a = E.entrySummary(es, crs), b = independent(crs);
      if (J(a) === J(b)) agree++;
      else rows.push(`CRS ${crs}: ${J(a)} vs ${J(b)}`);
      if (a.count) console.log(`  info  CRS ${String(crs).padStart(2)}: Last Entry Date ${E.ddmmyyyy(a.last)} | Total Entry Dates ${a.count}`);
    }
    check(`all 30 shops agree with the independent count (${agree}/30)`, agree === 30, rows.join('\n        '));
  }
}

console.log(failures ? `\n${failures} FAILED\n` : '\nENTRY DATES OK\n');
// exitCode, not exit(): exiting while the database socket closes trips a libuv assertion on Windows.
process.exitCode = failures ? 1 : 0;
