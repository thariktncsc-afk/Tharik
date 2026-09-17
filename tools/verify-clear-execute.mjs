/**
 * What an approved clear actually removes — and what it re-carries.
 *
 *   node tools/verify-clear-execute.mjs [--crs=1] [--date=2026-09-01]
 *
 * Runs the planner (src/lib/clearExecute.ts) over copies of the stores and
 * asserts the rules that matter. Writes nothing.
 *
 *   DAY CLEAR    the selected shop and date only: the sheet, its remittance,
 *                its inspection. Later saved days that carried their Opening
 *                from it are re-carried from the closing before it, across a
 *                month end too; an Opening set by hand is left alone.
 *   MONTH CLEAR  the selected shop and month: every month store AND every
 *                Daily Sales sheet and inspection dated in it. No other month,
 *                no other shop, no receipt.
 *
 * The re-carried figures are checked by the stock guard's own arithmetic
 * (open + receipt ± adjustments = total, total − sales = close), not by the
 * code under test.
 *
 * The last section repeats the day rules against the live data in
 * public/golden-stores.json when a sheet exists for --crs/--date.
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

const { planClear, monthDayKeys } = await import(pathToFileURL(join(root, 'src/lib/clearExecute.ts')).href);
const { resyncReceiptMonth } = await import(pathToFileURL(join(root, 'src/lib/engine/receiptSync.ts')).href);
const { expectedTotal, expectedClose, TOLERANCE } = await import(pathToFileURL(join(root, 'src/lib/stockGuard.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** One commodity row that adds up, adjustments included. */
const row = (open, receipt, sales, adj = {}) => {
  const excess = adj.excess ?? 0;
  const shortage = adj.shortage ?? 0;
  const transfer = adj.transfer ?? 0;
  const total = open + receipt + excess - shortage - transfer;
  return { open, receipt, total, sales, close: total - sales, amount: 0, excess, shortage, transfer };
};
const request = (crsId, storeKeys, scopeKind) => ({
  id: 999, crsId, shopName: 'test', storeKeys, modules: [], scopeKind, scopeLabel: storeKeys[0], requestedBy: 't',
  requestedById: null, requestedRole: 'BC', reason: 'verification', snapshot: {}, status: 'clearing', createdAt: '',
  decidedBy: 'admin', decidedAt: '', decisionNote: '', clearedAt: null, clearedRecords: [], lastError: null,
});
const asRows = (stores) => Object.fromEntries(Object.entries(stores).map(([k, v]) => [k, { data: clone(v), version: 1 }]));
const adds = (r) => Math.abs(Number(r.total) - expectedTotal(r)) <= TOLERANCE && Math.abs(Number(r.close) - expectedClose(r)) <= TOLERANCE;

// ── A day clear ─────────────────────────────────────────────────────────────
console.log('\nDay clear — CRS 1, 17 Sep 2026');
{
  const stores = {
    entryStore: {
      '1_2026-09-16': { a: { BRA: row(1000, 0, 100) }, b: {}, remitAmount: 10 },
      '1_2026-09-17': { a: { BRA: row(900, 500, 200, { shortage: 20 }) }, b: {}, remitAmount: 20, remits: [{ id: 'r17', amount: 20 }] },
      '1_2026-09-18': { a: { BRA: row(1180, 0, 300, { excess: 5 }) }, b: {}, remitAmount: 30 },
      '1_2026-09-19': { a: { BRA: row(885, 0, 100) }, b: {}, remitAmount: 40 },
      '1_2026-10-01': { a: { BRA: row(785, 0, 50) }, b: {}, remitAmount: 50 },
      '1_2026-11-30': { a: { BRA: row(735, 0, 35) }, b: {}, __projection: { source: 'monthly', at: 'x' } },
      '11_2026-09-17': { a: { BRA: row(300, 0, 30) }, b: {} },
      '11_2026-09-18': { a: { BRA: row(270, 0, 30) }, b: {} },
    },
    inspectionStore: {
      '1_2026-09-17': { a: { BRA: { shortage: 20 } } },
      '1_2026-09-18': { a: { BRA: { excess: 5 } } },
      '11_2026-09-17': { a: { BRA: { excess: 1 } } },
    },
    receiptStore: [{ id: 1, crsId: 1, date: '2026-09-17', receiptNo: 'R/1', items: { BRA: { qty: 500 } } }],
    salesCloseStore: { '1_9_2026': { date: '2026-09-19' } },
    meManualStore: {},
    meSourceStore: {},
    monthlyStore: {},
  };
  const rows = asRows(stores);
  const { next, cleared, recalculated } = planClear(request(1, ['1_2026-09-17'], 'day'), rows);
  const e = next.entryStore;

  check('the selected day sheet is removed', !('1_2026-09-17' in e));
  check('...its remittance with it (it lives on the sheet)', !Object.values(e).some((s) => s?.remits?.some?.((r) => r.id === 'r17')));
  check('...and the inspection recorded that date', !('1_2026-09-17' in next.inspectionStore));
  check('the day before is untouched', same(e['1_2026-09-16'], stores.entryStore['1_2026-09-16']));
  check('the next day’s inspection is untouched', same(next.inspectionStore['1_2026-09-18'], stores.inspectionStore['1_2026-09-18']));
  check('only the day was reported as removed', same(cleared.map((c) => c.key).sort(), ['1_2026-09-17', '1_2026-09-17']));
  check('the receipt register is not touched', next.receiptStore === undefined);
  check('Sales Close names the 19th, so it stays', next.salesCloseStore === undefined);

  const d18 = e['1_2026-09-18'].a.BRA;
  const d19 = e['1_2026-09-19'].a.BRA;
  const o01 = e['1_2026-10-01'].a.BRA;
  check('the 18th re-opens at the 16th’s closing plus the 17th’s delivery: 900 + 500 = 1400', d18.open === 1400, `got ${d18.open}`);
  check('...and its Total and Closing follow: 1405, 1105', d18.total === 1405 && d18.close === 1105, `got ${d18.total} / ${d18.close}`);
  check('the 19th re-opens at the 18th’s new closing, 1105', d19.open === 1105 && d19.close === 1005, `got ${d19.open} / ${d19.close}`);
  check('the carry crosses the month end: 1 Oct opens at 1005', o01.open === 1005 && o01.close === 955, `got ${o01.open} / ${o01.close}`);
  check('Receipt, Sales, adjustments and the rest of each sheet stay as keyed',
    d18.sales === 300 && d18.excess === 5 && d18.receipt === 0 && e['1_2026-09-18'].remitAmount === 30);
  check('every re-carried row adds up by the stock guard’s arithmetic', [d18, d19, o01].every(adds));
  check('the recalculated days are reported, in order', same(recalculated, ['1_2026-09-18', '1_2026-09-19', '1_2026-10-01']), recalculated.join(', '));
  check('a projected month sheet is never rewritten', same(e['1_2026-11-30'], stores.entryStore['1_2026-11-30']));
  check('CRS 11’s days on the same dates are untouched',
    same(e['11_2026-09-17'], stores.entryStore['11_2026-09-17']) && same(e['11_2026-09-18'], stores.entryStore['11_2026-09-18']) &&
    same(next.inspectionStore['11_2026-09-17'], stores.inspectionStore['11_2026-09-17']));
  check('both affected months are republished', !!next.monthlyStore?.['1_9_2026'] && !!next.monthlyStore?.['1_10_2026']);
  check('September no longer counts the cleared day’s sales: 100 + 300 + 100 = 500', Number(next.monthlyStore?.['1_9_2026']?.a?.BRA?.sales) === 500,
    `got ${next.monthlyStore?.['1_9_2026']?.a?.BRA?.sales}`);
  check('month stores are not touched by a DAY clear', next.meGunnyStore === undefined && next.meCardStore === undefined && next.meRemitStore === undefined);
}

console.log('\nDay clear — every later Opening follows the calendar, typed or not');
{
  const stores = {
    entryStore: {
      '2_2026-09-01': { a: { BRA: row(100, 0, 10), PALM: row(50, 0, 5) }, b: {} },
      '2_2026-09-02': { a: { BRA: row(90, 0, 10), PALM: row(45, 0, 5) }, b: {} },
      '2_2026-09-03': { a: { BRA: row(500, 0, 10), PALM: row(40, 0, 5) }, b: {} },
      '2_2026-09-04': { a: { BRA: row(490, 0, 10), PALM: row(35, 0, 5) }, b: {} },
    },
    inspectionStore: {},
    receiptStore: [],
  };
  const { next, recalculated } = planClear(request(2, ['2_2026-09-02'], 'day'), asRows(stores));
  const e = next.entryStore;
  check('BRA on the 3rd had a typed 500; it re-opens at the 1st’s Closing, 90', e['2_2026-09-03'].a.BRA.open === 90 && e['2_2026-09-03'].a.BRA.close === 80);
  check('...and the 4th follows at 80', e['2_2026-09-04'].a.BRA.open === 80 && e['2_2026-09-04'].a.BRA.close === 70);
  check('PALM on the same sheets re-carries too: 45, then 40', e['2_2026-09-03'].a.PALM.open === 45 && e['2_2026-09-04'].a.PALM.open === 40);
  check('both days are reported', same(recalculated, ['2_2026-09-03', '2_2026-09-04']));
}

console.log('\nDay clear — nothing before it to carry from');
{
  const stores = {
    entryStore: {
      '4_2026-09-01': { a: { BRA: row(100, 0, 10) }, b: {} },
      '4_2026-09-02': { a: { BRA: row(90, 0, 10) }, b: {} },
    },
    inspectionStore: {},
    receiptStore: [],
  };
  const { next, recalculated } = planClear(request(4, ['4_2026-09-01'], 'day'), asRows(stores));
  check('the first sheet ever keyed goes; the next keeps its Opening, having no earlier closing', same(next.entryStore['4_2026-09-02'], stores.entryStore['4_2026-09-02']));
  check('nothing is reported as recalculated', recalculated.length === 0);
}

// ── A month clear ───────────────────────────────────────────────────────────
console.log('\nMonth clear — CRS 3, September 2026');
{
  const month = (v) => ({ '3_8_2026': { v: `aug-${v}` }, '3_9_2026': { v: `sep-${v}` }, '3_10_2026': { v: `oct-${v}` }, '30_9_2026': { v: `crs30-${v}` } });
  const stores = {
    entryStore: {
      '3_2026-08-31': { a: { BRA: row(500, 0, 100) }, b: {} },
      '3_2026-09-01': { a: { BRA: row(400, 0, 50) }, b: {}, remitAmount: 5 },
      '3_2026-09-15': { a: { BRA: row(350, 0, 50) }, b: {}, remitAmount: 6 },
      '3_2026-09-30': { a: { BRA: row(300, 0, 0) }, b: {}, __projection: { source: 'monthly', at: 'x' } },
      '3_2026-10-01': { a: { BRA: row(300, 0, 20) }, b: {} },
      '30_2026-09-01': { a: { BRA: row(10, 0, 1) }, b: {} },
      '13_2026-09-15': { a: { BRA: row(20, 0, 2) }, b: {} },
    },
    inspectionStore: {
      '3_2026-08-31': { a: { BRA: { excess: 1 } } },
      '3_2026-09-15': { a: { BRA: { shortage: 2 } } },
      '30_2026-09-15': { a: { BRA: { shortage: 3 } } },
    },
    receiptStore: [
      { id: 7, crsId: 3, date: '2026-09-10', receiptNo: 'R/7', items: { BRA: { qty: 100 } } },
      { id: 8, crsId: 3, date: '2026-09-30', receiptNo: 'MR/3', items: { BRA: { qty: 50 } }, source: 'monthly-entry' },
    ],
    meManualStore: month('manual'),
    meRemitStore: month('remit'),
    meGunnyStore: month('gunny'),
    meCardStore: month('card'),
    meAllotStore: month('allot'),
    salesCloseStore: { '3_8_2026': { date: '2026-08-31' }, '3_9_2026': { date: '2026-09-15' } },
    monthlyStore: {},
    meSourceStore: {},
  };
  const { next, cleared, recalculated } = planClear(request(3, ['3_9_2026'], 'month'), asRows(stores));
  const e = next.entryStore;

  check('every Daily Sales sheet dated in September goes', !('3_2026-09-01' in e) && !('3_2026-09-15' in e));
  check('...the month-close projection with them', !('3_2026-09-30' in e));
  check('...and the inspection recorded in September', !('3_2026-09-15' in next.inspectionStore));
  for (const store of ['meManualStore', 'meRemitStore', 'meGunnyStore', 'meCardStore', 'meAllotStore']) {
    check(`${store}: September goes, August and October stay`,
      !('3_9_2026' in next[store]) && same(next[store]['3_8_2026'], stores[store]['3_8_2026']) && same(next[store]['3_10_2026'], stores[store]['3_10_2026']));
  }
  check('Sales Close for September goes, August’s stays', !('3_9_2026' in next.salesCloseStore) && same(next.salesCloseStore['3_8_2026'], stores.salesCloseStore['3_8_2026']));
  check('31 Aug is untouched', same(e['3_2026-08-31'], stores.entryStore['3_2026-08-31']));
  const oct = e['3_2026-10-01'].a.BRA;
  check('1 Oct re-opens across the cleared month: 31 Aug closes 400, + 150 received in September = 550',
    oct.open === 550 && oct.close === 530 && oct.sales === 20, `got ${oct.open} / ${oct.close}`);
  check('August’s inspection is untouched', same(next.inspectionStore['3_2026-08-31'], stores.inspectionStore['3_2026-08-31']));
  check('CRS 30 and CRS 13 are untouched though their keys look alike',
    same(e['30_2026-09-01'], stores.entryStore['30_2026-09-01']) && same(e['13_2026-09-15'], stores.entryStore['13_2026-09-15']) &&
    same(next.inspectionStore['30_2026-09-15'], stores.inspectionStore['30_2026-09-15']) && same(next.meManualStore['30_9_2026'], stores.meManualStore['30_9_2026']));
  check('the receipt register is not touched', next.receiptStore === undefined);
  check('only the day after the cleared month is recalculated', same(recalculated, ['3_2026-10-01']), recalculated.join(', '));
  check('the removed day sheets are on the trail', ['3_2026-09-01', '3_2026-09-15', '3_2026-09-30'].every((k) => cleared.some((c) => c.key === k && c.module === 'Daily Sales')));
  check('the month publishes no sales once cleared', !next.monthlyStore?.['3_9_2026'] || !Number(next.monthlyStore['3_9_2026']?.a?.BRA?.sales));

  const keys = monthDayKeys(stores, 3, 9, 2026);
  check('monthDayKeys (the request snapshot uses it too) names exactly the September days',
    same(keys, { entryStore: ['3_2026-09-01', '3_2026-09-15', '3_2026-09-30'], inspectionStore: ['3_2026-09-15'] }), JSON.stringify(keys));
}

// ── An approved clear of a RECEIPT ────────────────────────────────────────
// A receipt can be deleted two ways: an administrator on the Receipt page, or
// a shop's clear request once it is approved. The two must leave the data
// identical — otherwise which route was taken would show up in the statements.
console.log('\nAn approved clear of a receipt');
{
  const CR = 4;
  const mrec = { open: 1000, receipt: 1000, total: 2000, sales: 1000, close: 1000, amount: 0, excess: 0, shortage: 0, transfer: 0, cs: 0, g_cs: 0, g_open: 20, g_receipt: 20, g_total: 40, g_sales: 20, g_close: 20 };
  const proj = { a: { BRA: { open: 1000, receipt: 1000, total: 2000, sales: 1000, close: 1000, amount: 0, excess: 0, shortage: 0, transfer: 0 } }, b: {}, __projection: { source: 'monthly', at: 'x' } };
  const receipt = { id: 77, crsId: CR, date: '2026-09-09', receiptNo: 'R/77', items: { BRA: { qty: 1000 } } };
  const mk = () => ({
    entryStore: { data: { [`${CR}_2026-09-30`]: clone(proj) }, version: 1 },
    inspectionStore: { data: {}, version: 1 },
    meManualStore: { data: { [`${CR}_9_2026`]: { a: { BRA: { ...mrec } }, b: {} } }, version: 1 },
    meSourceStore: { data: { [`${CR}_9_2026`]: { a: { BRA: 'receipt' }, b: {} } }, version: 1 },
    monthlyStore: { data: { [`${CR}_9_2026`]: { a: { BRA: { ...mrec } }, b: {} } }, version: 1 },
    receiptStore: { data: [receipt], version: 1 },
  });

  const approved = planClear(request(CR, ['77'], 'receipt'), mk()).next;

  // The same deletion, taken the administrator's way.
  const r = mk();
  const direct = resyncReceiptMonth(
    { entryStore: r.entryStore.data, inspectionStore: {}, meManualStore: r.meManualStore.data,
      meSourceStore: r.meSourceStore.data, monthlyStore: r.monthlyStore.data, receiptStore: [] },
    CR, 9, 2026, { dateIso: '2026-09-09', before: [receipt] },
  );

  const bra = approved.monthlyStore?.[`${CR}_9_2026`]?.a?.BRA;
  check('the receipt itself goes', Array.isArray(approved.receiptStore) && approved.receiptStore.length === 0);
  check('the month drops its Receipt', bra?.receipt === 0, `got ${bra?.receipt}`);
  check('Total falls back to Opening and Closing to Total − Sales', bra?.total === 1000 && bra?.close === 0);
  check('the manual month lets go of the copy it held', approved.meManualStore?.[`${CR}_9_2026`]?.a?.BRA?.receipt === 0);
  check('the projected day sheet is rewritten', approved.entryStore?.[`${CR}_2026-09-30`]?.a?.BRA?.receipt === 0);
  check(
    'an approved clear and an administrator’s delete leave identical data',
    same(approved.monthlyStore, direct.monthlyStore) && same(approved.meManualStore, direct.meManualStore) && same(approved.entryStore, direct.entryStore),
  );
}

// ── The same day rules against the live data ───────────────────────────────
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=')[1];
const CRS = Number(arg('crs', 1));
const DATE = arg('date', '2026-09-01');
const DAY_KEY = `${CRS}_${DATE}`;
const [Y, M] = DATE.split('-').map(Number);
const MONTH_KEY = `${CRS}_${M}_${Y}`;
const goldenPath = join(root, 'public/golden-stores.json');

console.log(`\nLive data — CRS ${CRS}, ${DATE}`);
const live = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')).stores : null;
if (!live?.entryStore?.[DAY_KEY]) {
  console.log(`  note  no day sheet stored for ${DAY_KEY}; run dump-golden-stores.mjs to refresh.`);
} else {
  const rows = asRows(live);
  const { next, cleared, recalculated } = planClear(request(CRS, [DAY_KEY], 'day'), rows);
  console.log(`  removes ${cleared.length} record(s): ${cleared.map((c) => `${c.module} ${c.key}`).join(', ') || 'none'}`);
  check('the day sheet is removed', next.entryStore && !(DAY_KEY in next.entryStore));
  check('the removal is reported for the trail', cleared.some((c) => c.key === DAY_KEY && c.module === 'Daily Sales'));
  const others = Object.keys(live.entryStore).filter((k) => k !== DAY_KEY);
  const moved = new Set(recalculated);
  check(`every other sheet survives, unchanged unless re-carried (${moved.size} re-carried)`,
    others.every((k) => k in next.entryStore && (moved.has(k) || same(next.entryStore[k], live.entryStore[k]))));
  check('re-carried sheets are this shop’s, dated after the cleared day', [...moved].every((k) => k.startsWith(`${CRS}_`) && k.slice(k.indexOf('_') + 1) > DATE));
  check('re-carried rows add up', [...moved].every((k) => ['a', 'b'].every((s) => Object.values(next.entryStore[k][s] ?? {}).every(adds))));
  check('the month was republished', next.monthlyStore !== undefined);
  check('month stores are not touched by a DAY clear', next.meGunnyStore === undefined && next.meCardStore === undefined);
  check('receiptStore is not touched by a DAY clear', next.receiptStore === undefined);
  const sc = live.salesCloseStore?.[MONTH_KEY];
  if (sc) {
    const shouldGo = String(sc.date) === DATE;
    check(shouldGo ? 'Sales Close named this day, so it goes' : `Sales Close names ${sc.date}, so it stays`,
      shouldGo ? next.salesCloseStore && !(MONTH_KEY in next.salesCloseStore) : next.salesCloseStore === undefined);
  }
}

console.log(failures === 0 ? '\nCLEAR EXECUTE OK' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
