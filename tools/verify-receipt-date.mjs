/**
 * An administrator changes a saved receipt's DATE on the Receipt Register
 * (office, 2026-10-01; src/lib/engine/receiptDate.ts).
 *
 *   node tools/verify-receipt-date.mjs
 *
 *   1. the rule: a real date, not after today, not the same date, not
 *      Monthly Entry's own month row;
 *   2. the move is in place — same id, Receipt No., type and quantities, one
 *      row, nothing duplicated;
 *   3. within a month (23-09 → 30-09), through exactly what the Receipt page
 *      runs (resyncReceiptMonth for the old date and the new, rechain, both
 *      from the register before the move): 23-09 no longer counts it, the
 *      days between re-open lower, 30-09 counts it, the month's Receipt and
 *      Closing are unchanged, OB + Receipt = Total and Total − Sales = CB on
 *      every sheet;
 *   4. across months (30-09 → 01-10): September's Receipt and Closing drop,
 *      October's Receipt rises, and October opens at September's new Closing;
 *   5. DSS pages follow (a receipt-only date gains / loses its page);
 *   6. the statements read the register by date — the Receipt statement of
 *      the old month no longer lists it, the new month's does;
 *   7. the activity log: "Receipt Date Changed — No.: old → new" with the
 *      receipt number and both dates;
 *   8. wiring: the Receipt page (admin-only button, both months republished,
 *      tick after the database) and /api/state refusing shop staff.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
const SRC = ${JSON.stringify(srcUrl)};
export async function resolve(spec, ctx, next) {
  let s = spec;
  const rel = (s.startsWith('./') || s.startsWith('../')) && ctx.parentURL && ctx.parentURL.startsWith(SRC);
  if (s.startsWith('@/') || rel) {
    const base = s.startsWith('@/') ? SRC + s.slice(2) : new URL(s, ctx.parentURL).href;
    if (/\\.[a-z]+$/.test(s)) return next(base, ctx);
    for (const ext of ['.ts', '.tsx', '.js']) { try { return await next(base + ext, ctx); } catch {} }
  }
  return next(s, ctx);
}`)}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, 'src', p)).href);
const R = await imp('lib/engine/receiptDate.ts');
const { resyncReceiptMonth } = await imp('lib/engine/receiptSync.ts');
const { rechainAndRepublish } = await imp('lib/engine/rechain.ts');
const { rebuildMonthlyFromDaily } = await imp('lib/engine/monthlyRollup.ts');
const { entryListsFor } = await imp('lib/engine/commodities.ts');
const { dssDayCount } = await imp('lib/engine/dssDays.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const J = JSON.stringify;
const clone = (v) => JSON.parse(J(v));
const CRS = 23;
const lists = entryListsFor(CRS);
const row = (o) => ({ open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, ...o });
const RCP = { id: 82, crsId: CRS, date: '2026-09-23', receiptNo: 'R/2026/082', type: 'regular', items: { BRA: { qty: 3494 }, SUGAR: { qty: 680 } }, savedAt: '01/10/2026, 9:09:49 pm' };
// CRS 23 by day: 01-09 Initial Opening, then sheets on 23, 25 and 30 Sept and 01 Oct with sales.
function shop() {
  const st = { entryStore: {}, inspectionStore: {}, meManualStore: {}, meSourceStore: {}, monthlyStore: {}, receiptStore: [clone(RCP)] };
  const day = (d, sales) => (st.entryStore[`${CRS}_${d}`] = { a: { BRA: row({ sales: sales.BRA ?? 0 }), SUGAR: row({ sales: sales.SUGAR ?? 0 }) }, b: {}, remits: [] });
  st.entryStore[`${CRS}_2026-09-01`] = { a: { BRA: row({ open: 2000, total: 2000, close: 2000, openFixed: true }), SUGAR: row({ open: 500, total: 500, close: 500, openFixed: true }) }, b: {}, remits: [] };
  day('2026-09-23', { BRA: 100 });
  day('2026-09-25', { BRA: 200, SUGAR: 50 });
  day('2026-09-30', { BRA: 300 });
  day('2026-10-01', { BRA: 10 });
  // Settle the chain and the months as saved data would be.
  const all = rechainAndRepublish(st, CRS, '2026-09-01', lists);
  Object.assign(st, all.patch);
  return st;
}
// The Receipt page's republishMonth, step for step.
function republish(st, dateIso, before) {
  const [y, m] = dateIso.split('-').map(Number);
  Object.assign(st, resyncReceiptMonth(st, CRS, m, y, { dateIso, before, lists }));
  Object.assign(st, rechainAndRepublish(st, CRS, dateIso, lists).patch);
}
function move(st, to) {
  const before = clone(st.receiptStore);
  const from = before.find((r) => r.id === RCP.id).date;
  st.receiptStore = R.moveReceiptDate(before, RCP.id, to);
  republish(st, from, before);
  republish(st, to, before);
  return st;
}
const sheet = (st, d) => st.entryStore[`${CRS}_${d}`]?.a?.BRA;
const month = (st, m) => rebuildMonthlyFromDaily(CRS, m, 2026, st.entryStore, st.inspectionStore, st.meManualStore[`${CRS}_${m}_2026`], lists, st.receiptStore).merged.a.BRA;
const addsUp = (st) => Object.entries(st.entryStore).every(([, s]) => Object.values(s.a).every((r) => Math.abs(r.total - (r.open + r.receipt + r.excess - r.shortage - r.transfer)) < 1e-6 && Math.abs(r.close - (r.total - r.sales)) < 1e-6));

console.log('1. The rule');
{
  const T = '2026-10-01';
  check('a real date is required (31-09 is not one)', R.receiptDateProblem(RCP, '2026-09-31', T) !== null && R.receiptDateProblem(RCP, '', T) !== null);
  check('not after today', /after today/.test(R.receiptDateProblem(RCP, '2026-10-02', T) ?? ''));
  check('not the same date', /already/.test(R.receiptDateProblem(RCP, '2026-09-23', T) ?? ''));
  check('Monthly Entry\'s own month row is changed on Monthly Entry', /Monthly Entry/.test(R.receiptDateProblem({ ...RCP, source: 'monthly-entry' }, '2026-09-30', T) ?? ''));
  check('23-09 → 30-09 and → 01-10 are allowed', R.receiptDateProblem(RCP, '2026-09-30', T) === null && R.receiptDateProblem(RCP, '2026-10-01', T) === null);
}

console.log('\n2. In place: the same receipt, only its date changed');
{
  const reg = [clone(RCP), { ...clone(RCP), id: 83, receiptNo: 'R/2026/083' }];
  const after = R.moveReceiptDate(reg, 82, '2026-09-30');
  const moved = after.find((r) => r.id === 82);
  check(`one row per receipt (${after.length}); R/2026/082 now ${moved.date}; No., type, quantities unchanged`, after.length === 2 && moved.date === '2026-09-30' && J({ ...moved, date: RCP.date }) === J(RCP));
  check('the other receipt is untouched', J(after[1]) === J(reg[1]));
  const m = R.receiptDateMoves(reg, after);
  check(`seen as a date move: ${J(m)}`, J(m) === J([{ id: '82', crsId: 23, receiptNo: 'R/2026/082', from: '2026-09-23', to: '2026-09-30' }]));
  check('a quantity change or a new receipt is not a date move', R.receiptDateMoves(reg, [{ ...reg[0], items: {} }, reg[1]]).length === 0 && R.receiptDateMoves([], reg).length === 0);
}

console.log('\n3. Within the month: 23-09 → 30-09');
{
  const st = shop();
  const b23 = sheet(st, '2026-09-23'), b25 = sheet(st, '2026-09-25'), b30 = sheet(st, '2026-09-30'), sepB = month(st, 9);
  check(`before: 23-09 Receipt ${b23.receipt}, 25-09 opens ${b25.open}, 30-09 Receipt ${b30.receipt} closes ${b30.close}`, b23.receipt === 3494 && b30.receipt === 0);
  move(st, '2026-09-30');
  const a23 = sheet(st, '2026-09-23'), a25 = sheet(st, '2026-09-25'), a30 = sheet(st, '2026-09-30'), sepA = month(st, 9);
  check(`23-09 no longer counts it: Receipt ${a23.receipt}, Closing ${a23.close} (was ${b23.close})`, a23.receipt === 0 && a23.close === b23.close - 3494);
  check(`25-09 re-opens at 23-09's new Closing: ${a25.open} (was ${b25.open})`, a25.open === a23.close && a25.open === b25.open - 3494);
  check(`30-09 counts it: Receipt ${a30.receipt}, Closing ${a30.close} (was ${b30.close})`, a30.receipt === 3494 && a30.close === b30.close);
  check(`September: Receipt ${sepA.receipt} and Closing ${sepA.close} unchanged (${sepB.receipt} / ${sepB.close})`, sepA.receipt === sepB.receipt && sepA.close === sepB.close);
  check('OB + Receipt = Total, Total − Sales = CB on every sheet', addsUp(st));
  check(`01-10 still opens at 30-09's Closing: ${sheet(st, '2026-10-01').open}`, sheet(st, '2026-10-01').open === a30.close);
}

console.log('\n4. Across months: 30-09 → 01-10');
{
  const st = move(shop(), '2026-09-30');
  const sepB = month(st, 9), octB = month(st, 10);
  move(st, '2026-10-01');
  const sepA = month(st, 9), octA = month(st, 10);
  check(`September Receipt ${sepB.receipt} → ${sepA.receipt}, Closing ${sepB.close} → ${sepA.close}`, sepA.receipt === sepB.receipt - 3494 && sepA.close === sepB.close - 3494);
  check(`October Receipt ${octB.receipt} → ${octA.receipt}; opens at September's new Closing (${octA.open} = ${sepA.close})`, octA.receipt === octB.receipt + 3494 && octA.open === sepA.close);
  check(`01-10 sheet: Receipt ${sheet(st, '2026-10-01').receipt}, Closing ${sheet(st, '2026-10-01').close} — where it closed before the move`, sheet(st, '2026-10-01').receipt === 3494 && sheet(st, '2026-10-01').close === octB.close);
  check('every sheet still adds up', addsUp(st));
  check('the published months follow (monthlyStore)', st.monthlyStore[`${CRS}_9_2026`].a.BRA.receipt === sepA.receipt && st.monthlyStore[`${CRS}_10_2026`].a.BRA.receipt === octA.receipt);
}

console.log('\n5. DSS pages follow the register');
{
  const st = shop();
  delete st.entryStore[`${CRS}_2026-09-23`]; // a receipt-only date: its DSS page is the receipt's
  const before = dssDayCount(st.entryStore, st.inspectionStore, st.receiptStore, CRS, 9, 2026);
  const moved = R.moveReceiptDate(st.receiptStore, 82, '2026-09-30');
  const after = dssDayCount(st.entryStore, st.inspectionStore, moved, CRS, 9, 2026);
  check(`23-09 had a receipt-only page (${before} pages); moved onto 30-09's sheet → ${after} pages`, after === before - 1);
}

console.log('\n6. The statements read the register by date');
{
  const render = (st, m) => {
    const stores = { ...clone(st), meRemitStore: {}, meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {} };
    const e = createStatementEngine({ stores, users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null });
    return e.buildSection('receipt', e.getData(CRS, m, 2026));
  };
  const st = shop();
  check('before: September\'s Receipt statement lists R/2026/082', render(st, 9).includes('R/2026/082') && !render(st, 10).includes('R/2026/082'));
  move(st, '2026-10-01');
  check('after → 01-10: September\'s no longer does, October\'s does', !render(st, 9).includes('R/2026/082') && render(st, 10).includes('R/2026/082'));
}

console.log('\n7. The activity log: "Receipt Date Changed"');
{
  const before = { receiptStore: [clone(RCP)] };
  const after = { receiptStore: R.moveReceiptDate([clone(RCP)], 82, '2026-09-30') };
  const rows = diffStateWrite(before, after).filter((d) => d.module === 'Receipt');
  const r = rows[0];
  check(`one row: "${r?.summary}"`, rows.length === 1 && r.summary === 'Receipt Date Changed — R/2026/082: 23-09-2026 → 30-09-2026');
  check(`CRS ${r?.crsId}, entry date ${r?.entryDate}; changes ${J(r?.changes)}`, r.crsId === 23 && r.entryDate === '2026-09-30' && r.changes[0].label === 'Receipt no' && r.changes[0].after === 'R/2026/082' && r.changes[1].label === 'Receipt date' && r.changes[1].before === '23-09-2026' && r.changes[1].after === '30-09-2026' && r.changes.length === 2);
}

console.log('\n8. Wiring');
{
  const page = readFileSync(join(root, 'src/app/(app)/receipt/page.tsx'), 'utf8');
  const route = readFileSync(join(root, 'src/app/api/state/route.ts'), 'utf8');
  check('the Edit Date button shows for administrators only, never on Monthly Entry\'s own row', /\{isAdmin && r\.source !== 'monthly-entry' && dateEdit\?\.id !== r\.id \?/.test(page));
  check('the save moves the row in place and republishes the old date AND the new, from the register before the move', /moveReceiptDate\(beforeMove, rec\.id, to\)/.test(page) && /republishMonth\(Number\(rec\.crsId\), from, beforeMove\)/.test(page) && /republishMonth\(Number\(rec\.crsId\), to, beforeMove\)/.test(page));
  check('the tick only after the database (saveConfirmed)', /if \(!\(await crsData\.saveConfirmed\(\)\)\) \{\s*setBanner\(refusal\(`The date of receipt/.test(page) && /saveSuccess\(receiptDateChanged\(/.test(page));
  check('/api/state refuses a shop user\'s date change (receiptDateMoves, 403)', /receiptDateMoves\(stored\.receiptStore, stores\.receiptStore\)/.test(route) && /Only an administrator may change a saved receipt/.test(route));
  const guardAt = route.indexOf('receiptDateMoves(stored.receiptStore');
  check('…inside the shop-staff branch (administrators pass)', guardAt > route.indexOf('if (!isAdmin) {') && guardAt < route.indexOf('// ── Stock field guard'));
}

console.log(failures ? `\n${failures} FAILED` : '\nALL RECEIPT-DATE CHECKS PASSED');
process.exit(failures ? 1 : 0);
