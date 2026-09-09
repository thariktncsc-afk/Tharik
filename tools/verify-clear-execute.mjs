/**
 * What an approved clear actually removes — checked against the live data.
 *
 *   node tools/dump-golden-stores.mjs
 *   node tools/verify-clear-execute.mjs [--crs=1] [--date=2026-09-01]
 *
 * Runs the planner (src/lib/clearExecute.ts) over a COPY of the dumped stores
 * and asserts the rules that matter: the day and its remittance go, the
 * inspection for that date goes, the month is recomputed rather than left
 * stale, and NOTHING outside the approved scope is touched. Writes nothing.
 */
import { readFileSync } from 'node:fs';
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

const { planClear } = await import(pathToFileURL(join(root, 'src/lib/clearExecute.ts')).href);
const { resyncReceiptMonth } = await import(pathToFileURL(join(root, 'src/lib/engine/receiptSync.ts')).href);

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=')[1];
const CRS = Number(arg('crs', 1));
const DATE = arg('date', '2026-09-01');
const [Y, M] = DATE.split('-').map(Number);
const DAY_KEY = `${CRS}_${DATE}`;
const MONTH_KEY = `${CRS}_${M}_${Y}`;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const stores = JSON.parse(readFileSync(join(root, 'public/golden-stores.json'), 'utf8')).stores;
const rows = {};
for (const [k, v] of Object.entries(stores)) rows[k] = { data: v, version: 1 };

const before = rows.entryStore?.data?.[DAY_KEY];
console.log(`CRS ${CRS} — ${DATE}\n${'─'.repeat(70)}`);
if (!before) {
  console.log(`  note  no day sheet stored for ${DAY_KEY}; run dump-golden-stores.mjs to refresh.`);
  process.exit(0);
}
const f = (r) => (r ? `open ${r.open ?? 0} receipt ${r.receipt ?? 0} sales ${r.sales ?? 0} close ${r.close ?? 0}` : '—');
console.log(`  before  BRA ${f(before.a?.BRA)}`);
console.log(`  before  remittance ₹${before.remitAmount ?? 0} on ${before.remitDate ?? '—'} (${(before.remits ?? []).length} row(s))`);

const req = {
  id: 999, crsId: CRS, shopName: 'test', storeKeys: [DAY_KEY], modules: ['Daily Sales'],
  scopeKind: 'day', scopeLabel: DATE, requestedBy: 't', requestedById: null, requestedRole: 'BC',
  reason: 'verification', snapshot: {}, status: 'clearing', createdAt: '', decidedBy: 'admin',
  decidedAt: '', decisionNote: '', clearedAt: null, clearedRecords: [], lastError: null,
};

const { next, cleared } = planClear(req, rows);
console.log(`\n  removes ${cleared.length} record(s): ${cleared.map((c) => `${c.module} ${c.key}`).join(', ') || 'none'}`);

console.log('\nthe day and everything on it');
check('the day sheet is removed', next.entryStore && !(DAY_KEY in next.entryStore));
check('the remittance goes with it (it lives on the sheet)', !next.entryStore?.[DAY_KEY]);
check('the inspection for that date is removed', !next.inspectionStore || !(DAY_KEY in next.inspectionStore));
check('the removal is reported for the trail', cleared.some((c) => c.key === DAY_KEY && c.module === 'Daily Sales'));

console.log('\ndependent data is recomputed, not left stale');
const monthBefore = rows.monthlyStore?.data?.[MONTH_KEY];
const monthAfter = next.monthlyStore?.[MONTH_KEY];
check('the month was republished', next.monthlyStore !== undefined);
const salesBefore = Number(monthBefore?.a?.BRA?.sales) || 0;
const salesAfter = Number(monthAfter?.a?.BRA?.sales) || 0;
check(
  `the cleared day no longer counts in Monthly Entry (BRA sales ${salesBefore} → ${salesAfter})`,
  salesAfter < salesBefore || salesBefore === 0,
  `before ${salesBefore}, after ${salesAfter}`,
);
check('the source flags were republished alongside', next.meSourceStore !== undefined);

console.log('\nnothing outside the approved scope is touched');
const otherDays = Object.keys(rows.entryStore.data).filter((k) => k !== DAY_KEY);
check(
  `all ${otherDays.length} other day sheet(s) survive unchanged`,
  otherDays.every((k) => JSON.stringify(next.entryStore[k]) === JSON.stringify(rows.entryStore.data[k])),
);
const otherShopDays = otherDays.filter((k) => !k.startsWith(`${CRS}_`));
check(`other shops' ${otherShopDays.length} sheet(s) untouched`, otherShopDays.every((k) => k in next.entryStore));
check('meManualStore is not touched by a DAY clear', next.meManualStore === undefined);
check('meGunnyStore is not touched by a DAY clear', next.meGunnyStore === undefined);
check('meCardStore is not touched by a DAY clear', next.meCardStore === undefined);
check('receiptStore is not touched by a DAY clear', next.receiptStore === undefined);

const sc = rows.salesCloseStore?.data?.[MONTH_KEY];
if (sc) {
  const shouldGo = String(sc.date) === DATE;
  check(
    shouldGo ? 'Sales Close named this day, so it goes' : `Sales Close names ${sc.date}, so it stays`,
    shouldGo ? next.salesCloseStore && !(MONTH_KEY in next.salesCloseStore) : next.salesCloseStore === undefined,
  );
} else {
  console.log('  note  no Sales Close mark for this month');
}

// ── An approved clear of a RECEIPT ────────────────────────────────────────
// A receipt can be deleted two ways: an administrator on the Receipt page, or
// a shop's clear request once it is approved. The two must leave the data
// identical — otherwise which route was taken would show up in the statements.
console.log('\nan approved clear of a receipt');
{
  const CR = 4;
  const mrec = { open: 1000, receipt: 1000, total: 2000, sales: 1000, close: 1000, amount: 0, excess: 0, shortage: 0, transfer: 0, cs: 0, g_cs: 0, g_open: 20, g_receipt: 20, g_total: 40, g_sales: 20, g_close: 20 };
  const proj = { a: { BRA: { open: 1000, receipt: 1000, total: 2000, sales: 1000, close: 1000, amount: 0, excess: 0, shortage: 0, transfer: 0 } }, b: {}, __projection: { source: 'monthly', at: 'x' } };
  const receipt = { id: 77, crsId: CR, date: '2026-09-09', receiptNo: 'R/77', items: { BRA: { qty: 1000 } } };
  const mk = () => ({
    entryStore: { data: { [`${CR}_2026-09-30`]: JSON.parse(JSON.stringify(proj)) }, version: 1 },
    inspectionStore: { data: {}, version: 1 },
    meManualStore: { data: { [`${CR}_9_2026`]: { a: { BRA: { ...mrec } }, b: {} } }, version: 1 },
    meSourceStore: { data: { [`${CR}_9_2026`]: { a: { BRA: 'receipt' }, b: {} } }, version: 1 },
    monthlyStore: { data: { [`${CR}_9_2026`]: { a: { BRA: { ...mrec } }, b: {} } }, version: 1 },
    receiptStore: { data: [receipt], version: 1 },
  });

  const req2 = {
    id: 1000, crsId: CR, shopName: 'test', storeKeys: ['77'], modules: ['Receipt'],
    scopeKind: 'receipt', scopeLabel: '2026-09-09', requestedBy: 't', requestedById: null, requestedRole: 'BC',
    reason: 'verification', snapshot: {}, status: 'clearing', createdAt: '', decidedBy: 'admin',
    decidedAt: '', decisionNote: '', clearedAt: null, clearedRecords: [], lastError: null,
  };
  const approved = planClear(req2, mk()).next;

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
    JSON.stringify(approved.monthlyStore) === JSON.stringify(direct.monthlyStore) &&
      JSON.stringify(approved.meManualStore) === JSON.stringify(direct.meManualStore) &&
      JSON.stringify(approved.entryStore) === JSON.stringify(direct.entryStore),
  );
}

console.log(failures === 0 ? '\nCLEAR EXECUTE OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
