/**
 * Proves a change to the monthly roll-up (src/lib/engine/monthlyRollup.ts)
 * against two things the golden statements cannot see:
 *
 *   1. Every live month, old roll-up vs new. verify-statements renders from
 *      the stored monthlyStore and never runs the roll-up, but production
 *      does (src/lib/payments/server.ts rebuilds the month before rendering),
 *      so a roll-up change reaches every statement without the goldens ever
 *      noticing. This diff does: the roll-up at --base (default: dev) and the
 *      working tree must publish identical figures for every month in
 *      public/golden-stores.json.
 *   2. The two-mode rules the goldens have no data for — projected sheets are
 *      never read back, inspections alone never lock a row, a real sheet wins
 *      over a stale projection — as small synthetic months.
 *
 *   node tools/dump-golden-stores.mjs        (refresh the data dump first)
 *   node tools/verify-rollup.mjs [--base=<git-ref>]
 *
 * Runs the TypeScript sources directly (Node ≥ 23.6 strips types); the
 * registered resolver maps the project's `@/` alias onto src/.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
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

const base = (process.argv.find((a) => a.startsWith('--base=')) ?? '--base=dev').slice('--base='.length);
const oldSrc = execFileSync('git', ['show', `${base}:src/lib/engine/monthlyRollup.ts`], { cwd: root, encoding: 'utf8' });
const oldPath = join(mkdtempSync(join(tmpdir(), 'crs-rollup-')), 'monthlyRollup.ts');
writeFileSync(oldPath, oldSrc);

const NEW = await import(pathToFileURL(join(root, 'src/lib/engine/monthlyRollup.ts')).href);
const OLD = await import(pathToFileURL(oldPath).href);
const PROJ = await import(pathToFileURL(join(root, 'src/lib/engine/monthProjection.ts')).href);
const { bagsOf } = await import(pathToFileURL(join(root, 'src/lib/engine/commodities.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const canon = (v) =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const near = (a, b) => Math.abs(a - b) < 1e-6;

// ── 1. Live months: old vs new ─────────────────────────────────────────────
console.log(`live months (roll-up at ${base} vs working tree)`);
const S = JSON.parse(readFileSync(join(root, 'public/golden-stores.json'), 'utf8')).stores;
const entryStore = S.entryStore ?? {};
const inspectionStore = S.inspectionStore ?? {};
const manualStore = S.meManualStore ?? {};
const receiptStore = S.receiptStore ?? [];

const months = new Set([...Object.keys(manualStore), ...Object.keys(S.monthlyStore ?? {})]);
for (const k of [...Object.keys(entryStore), ...Object.keys(inspectionStore)]) {
  const m = /^(\d+)_(\d{4})-(\d{2})-\d{2}$/.exec(k);
  if (m) months.add(`${m[1]}_${Number(m[3])}_${m[2]}`);
}
const differing = [];
const identityBreaks = [];
let rows = 0;
for (const key of [...months].sort()) {
  const [crs, m, y] = key.split('_').map(Number);
  const args = [crs, m, y, entryStore, inspectionStore, manualStore[key], undefined, receiptStore];
  const before = OLD.rebuildMonthlyFromDaily(...args);
  const after = NEW.rebuildMonthlyFromDaily(...args);
  if (canon(before) !== canon(after)) differing.push(key);
  // Arithmetic that does not depend on either implementation.
  for (const sec of ['a', 'b']) {
    for (const [id, r] of Object.entries(after.merged[sec])) {
      rows++;
      const total = (+r.open || 0) + (+r.receipt || 0) + (+r.excess || 0) - (+r.shortage || 0) - (+r.transfer || 0);
      const close = total - (+r.sales || 0) - (+r.cs || 0);
      if (!near(+r.total || 0, total) || !near(+r.close || 0, close)) {
        identityBreaks.push(`${key} ${sec}:${id} (stored total ${r.total} / close ${r.close}; arithmetic ${+total.toFixed(3)} / ${+close.toFixed(3)}, source ${after.source[sec][id]})`);
      }
    }
  }
}
check(`${months.size} months publish identical figures`, differing.length === 0, differing.length ? `differ: ${differing.join(', ')}` : '');
console.log(`  note  ${rows} published rows; ${identityBreaks.length} do not satisfy open+receipt±adj=total, total−sales−cs=close (data as stored, same under both)`);
for (const line of identityBreaks.slice(0, 10)) console.log(`        ${line}`);

// ── 2. The two-mode rules ──────────────────────────────────────────────────
console.log('synthetic months');
const CRS = 9;
const M = 9;
const Y = 2026;
const LAST = PROJ.lastDayOfMonth(M, Y);
const manualRow = (open, receipt, sales, id) => {
  const total = open + receipt;
  const close = total - sales;
  return {
    open, receipt, total, sales, close, amount: 0, excess: 0, shortage: 0, transfer: 0, cs: 0, g_cs: 0,
    g_open: bagsOf(open, id), g_receipt: bagsOf(receipt, id), g_total: bagsOf(total, id), g_sales: bagsOf(sales, id), g_close: bagsOf(close, id),
  };
};
const manual = { a: { SUGAR: manualRow(100, 50, 120, 'SUGAR') }, b: {} };
const run = (entries, insps, man = manual) => NEW.rebuildMonthlyFromDaily(CRS, M, Y, entries, insps, man, undefined, []);

check('last day: Sept 30, July 31, Feb 28 / leap 29', LAST === '2026-09-30' && PROJ.lastDayOfMonth(7, 2026) === '2026-07-31' && PROJ.lastDayOfMonth(2, 2026) === '2026-02-28' && PROJ.lastDayOfMonth(2, 2028) === '2028-02-29');

// Mode B: the projected sheet is an output of the month, never an input.
const projected = PROJ.buildProjectedSheet({ a: { SUGAR: { open: 100, receipt: 50, total: 150, sales: 999, close: -849, amount: 0, excess: 0, shortage: 0, transfer: 0 } }, b: {} }, '2026-09-30T12:00:00Z');
{
  const entries = { [`${CRS}_${LAST}`]: projected };
  const r = run(entries, {});
  check('Mode B: projected sheet is not read back — manual row stays, keyable', canon(r.merged.a.SUGAR) === canon(manual.a.SUGAR) && r.source.a.SUGAR === 'manual', `got sales=${r.merged.a.SUGAR?.sales} source=${r.source.a.SUGAR}`);
  const o = OLD.rebuildMonthlyFromDaily(CRS, M, Y, entries, {}, manual, undefined, []);
  console.log(`  note  (the ${base} roll-up reads it as a day: sales=${o.merged.a.SUGAR?.sales}, source=${o.source.a.SUGAR})`);
  check('Mode B: realSheetDates ignores the projection', PROJ.realSheetDates(entries, CRS, M, Y).length === 0);
  check('Mode B: CRS 1 prefix does not match CRS 11 keys', PROJ.realSheetDates({ '11_2026-09-05': { a: {} } }, 1, M, Y).length === 0);
}

// Inspection alone overlays the manual row instead of locking it to zeros.
{
  const r = run({}, { [`${CRS}_${LAST}`]: { a: { SUGAR: { shortage: 5 } } } });
  const s = r.merged.a.SUGAR;
  check(
    'inspection only: manual figures kept, shortage applied, total/close recomputed, row keyable',
    s.open === 100 && s.receipt === 50 && s.sales === 120 && s.shortage === 5 && near(s.total, 145) && near(s.close, 25) && s.g_total === bagsOf(145, 'SUGAR') && r.source.a.SUGAR === 'manual',
    `got ${JSON.stringify(s)} source=${r.source.a.SUGAR}`,
  );
  const o = OLD.rebuildMonthlyFromDaily(CRS, M, Y, {}, { [`${CRS}_${LAST}`]: { a: { SUGAR: { shortage: 5 } } } }, manual, undefined, []);
  console.log(`  note  (the ${base} roll-up: open=${o.merged.a.SUGAR?.open} sales=${o.merged.a.SUGAR?.sales} source=${o.source.a.SUGAR})`);
}
{
  const r = run({}, { [`${CRS}_${LAST}`]: { a: { SUGAR: { shortage: 5 } } } }, { a: {}, b: {} });
  const s = r.merged.a.SUGAR;
  check('inspection only, nothing keyed: adjustment published on a keyable row', s && s.open === 0 && s.shortage === 5 && near(s.total, -5) && r.source.a.SUGAR === 'manual', `got ${JSON.stringify(s)} source=${r.source.a.SUGAR}`);
}

// Mode A: a real sheet wins, and a stale projection can never double-count.
{
  const real = { a: { SUGAR: { open: 100, receipt: 0, total: 100, sales: 10, close: 90, amount: 0 } }, b: {} };
  const entries = { [`${CRS}_2026-09-05`]: real, [`${CRS}_${LAST}`]: projected };
  const r = run(entries, {});
  check('Mode A: real sheet accumulates, projection ignored even if left behind', r.merged.a.SUGAR.sales === 10 && r.source.a.SUGAR === 'daily', `got sales=${r.merged.a.SUGAR?.sales}`);
  check('Mode A: realSheetDates lists only the real sheet', canon(PROJ.realSheetDates(entries, CRS, M, Y)) === canon(['2026-09-05']));
  const r2 = run(entries, { [`${CRS}_${LAST}`]: { a: { SUGAR: { shortage: 5 } } } });
  check('Mode A + last-day inspection: sheet + adjustment, total 95 close 85', near(r2.merged.a.SUGAR.total, 95) && near(r2.merged.a.SUGAR.close, 85), `got ${JSON.stringify(r2.merged.a.SUGAR)}`);
}

// Projected adjustments: written only where nobody recorded one, dropped with the sheet.
{
  const whole = { a: { SUGAR: { open: 100, receipt: 50, total: 145, sales: 120, close: 25, amount: 0, excess: 0, shortage: 5, transfer: 0 } }, b: {} };
  const insp = {};
  const n = PROJ.applyProjectedAdjustments(insp, CRS, M, Y, whole);
  const e = insp[`${CRS}_${LAST}`]?.a?.SUGAR;
  check('projection writes the manual-sourced shortage, marked', n === 1 && e?.shortage === 5 && e?.__projection === true, JSON.stringify(insp));
  check('projection is idempotent', PROJ.applyProjectedAdjustments(insp, CRS, M, Y, whole) === 1 && canon(insp[`${CRS}_${LAST}`].a.SUGAR) === canon(e));
  const entries = { [`${CRS}_${LAST}`]: projected, [`${CRS}_2026-09-05`]: { a: {}, b: {} } };
  check('drop: sheet goes, real sheet stays', PROJ.dropProjectedSheet(entries, CRS, M, Y) === true && !entries[`${CRS}_${LAST}`] && !!entries[`${CRS}_2026-09-05`]);
  check('drop: marked adjustment goes, record removed when empty', PROJ.dropProjectedAdjustments(insp, CRS, M, Y) === 1 && !insp[`${CRS}_${LAST}`]);

  const real = { [`${CRS}_${LAST}`]: { a: { SUGAR: { shortage: 2 } } } };
  const before = canon(real);
  check('projection never overwrites a recorded entry', PROJ.applyProjectedAdjustments(real, CRS, M, Y, whole) === 0 && canon(real) === before);
  check('drop leaves recorded entries alone', PROJ.dropProjectedAdjustments(real, CRS, M, Y) === 0 && canon(real) === before);
  const spokenElsewhere = { [`${CRS}_2026-09-10`]: { a: { SUGAR: { shortage: 3 } } } };
  check('projection skips a commodity an inspection already spoke for', PROJ.applyProjectedAdjustments(spokenElsewhere, CRS, M, Y, whole) === 0 && !spokenElsewhere[`${CRS}_${LAST}`]);
}

console.log(failures === 0 ? '\nROLLUP OK' : `\n${failures} ROLLUP FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
