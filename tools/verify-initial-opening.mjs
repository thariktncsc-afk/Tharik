/**
 * Admin full correction + the one-time Initial Opening Balance, as executable
 * cases — the scenarios the office asked to be tested (A–H), at the level the
 * rule actually lives: /api/state's guard (src/lib/stockGuard.ts), the shop's
 * persistent started record (src/lib/engine/stockInit.ts), and the chain
 * rebuild every save runs (src/lib/engine/rechain.ts).
 *
 *   node tools/verify-initial-opening.mjs
 *
 * The guard is what a request from devtools meets, so every "shop user cannot"
 * below is a POST that would be refused, not a greyed-out box.
 */
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

const G = await import(pathToFileURL(join(root, 'src/lib/stockGuard.ts')).href);
const I = await import(pathToFileURL(join(root, 'src/lib/engine/stockInit.ts')).href);
const C = await import(pathToFileURL(join(root, 'src/lib/engine/stockChain.ts')).href);
const R = await import(pathToFileURL(join(root, 'src/lib/engine/rechain.ts')).href);
const M = await import(pathToFileURL(join(root, 'src/lib/engine/remittance.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const USER = false;
const ADMIN = true;
const kinds = (v) => v.map((x) => x.kind);
const judge = (stored, incoming, who = USER) => G.inspectStockWrite(stored, incoming, who);

/** A row that adds up. */
const row = (open, receipt, sales, extra = {}) => {
  const total = open + receipt;
  return { open, receipt, total, sales, close: total - sales, amount: 0, excess: 0, shortage: 0, transfer: 0, ...extra };
};
const day = (bra, extra = {}) => ({ a: { BRA: bra }, b: {}, ...extra });
/** What the server does after a write lands: reconcile every shop it touched. */
const land = (init, before, after, by = 'user') => I.reconcileStockInit(init, after, I.shopsTouchedBy(before, after), by, 'now').next;
const started = (...ids) => Object.fromEntries(ids.map((id) => [String(id), { date: '2026-09-01', at: 'x', by: 'seed', source: 'seed' }]));

/** A started shop's three consecutive days, chained correctly. */
const chainOf = (crs) => ({
  [`${crs}_2026-09-15`]: day(row(1000, 0, 100, { openFixed: true })),
  [`${crs}_2026-09-16`]: day(row(900, 0, 50)),
  [`${crs}_2026-09-17`]: day(row(850, 0, 30)),
});

for (const [label, crs] of [['A', 7], ['B', 19], ['C', 30]]) {
  console.log(`\nTest ${label} — CRS ${crs}: already started`);
  const stored = { entryStore: chainOf(crs), __stockInit: started(crs) };
  const retyped = { entryStore: { ...stored.entryStore, [`${crs}_2026-09-17`]: day(row(999, 0, 30)) } };
  check('a shop user cannot type a different Opening', kinds(judge(stored, retyped)).includes('opening-locked'));
  check('… not even on the first day of the chain', kinds(judge(stored, { entryStore: { ...stored.entryStore, [`${crs}_2026-09-15`]: day(row(1200, 0, 100, { openFixed: true })) } })).includes('opening-locked'));
  check('a shop user may still save the day with the carried Opening and new Sales', judge(stored, { entryStore: { ...stored.entryStore, [`${crs}_2026-09-17`]: day(row(850, 0, 40)) } }).length === 0);
  check('an administrator may correct it', judge(stored, { entryStore: { ...stored.entryStore, [`${crs}_2026-09-17`]: day(row(999, 0, 30, { openFixed: true })) } }, ADMIN).length === 0);
  check('the shop user may not key a day before the shop started', kinds(judge(stored, { entryStore: { ...stored.entryStore, [`${crs}_2026-08-31`]: day(row(0, 0, 0)) } })).includes('before-initial-date'));
}

console.log('\nTest D — CRS 1: never started');
{
  const init = {};
  const first = { '1_2026-09-18': day(row(500, 0, 0, { openFixed: true })) };
  check('CRS 1 is not started', !I.isInitialized(init, 1));
  check('the shop user may type the Initial Opening (500)', judge({ entryStore: {}, __stockInit: init }, { entryStore: first }).length === 0);
  const after = land(init, {}, first, 'crs1');
  check('saving it starts CRS 1, dated its first day', I.initialDate(after, 1) === '2026-09-18', JSON.stringify(after));
  check('CRS 1 is now started', I.isInitialized(after, 1));

  const stored = { entryStore: first, __stockInit: after };
  check('the shop user cannot type it again', kinds(judge(stored, { entryStore: { '1_2026-09-18': day(row(600, 0, 0, { openFixed: true })) } })).includes('opening-locked'));
  check('nor remove its Initial mark', kinds(judge(stored, { entryStore: { '1_2026-09-18': day(row(500, 0, 0)) } })).includes('opening-locked'));

  // The next day carries the Closing: 500 − 120 sold on the 18th.
  const withSales = { '1_2026-09-18': day(row(500, 0, 120, { openFixed: true })) };
  const next = { ...withSales, '1_2026-09-19': day(row(380, 0, 10)) };
  check('the next day saves with Opening = previous Closing (380)', judge({ entryStore: withSales, __stockInit: after }, { entryStore: next }).length === 0);
  check('… and not with a typed one', kinds(judge({ entryStore: withSales, __stockInit: after }, { entryStore: { ...withSales, '1_2026-09-19': day(row(500, 0, 10)) } })).includes('opening-locked'));
  const ix = C.buildChainIndex(next, {}, [], 1);
  check('the chain carries 380 into the 19th', C.openingFor(ix, '2026-09-19', 'BRA', 'a').value === 380);
}

console.log('\nTest E — an inactive shop that never started');
{
  // Active/inactive lives in __shops / __crsMaster; the started record never reads either.
  const init = {};
  check('inactive and never started: not started', !I.isInitialized(init, 13));
  const activated = { ...init }; // Inactive → Active changes nothing here
  check('made active: still not started, so the one-time Opening is available', !I.isInitialized(activated, 13));
  check('its user may type it', judge({ entryStore: {}, __stockInit: activated }, { entryStore: { '13_2026-10-01': day(row(250, 0, 0, { openFixed: true })) } }).length === 0);
  const after = land(activated, {}, { '13_2026-10-01': day(row(250, 0, 0, { openFixed: true })) }, 'crs13');
  check('after saving it is locked', kinds(judge({ entryStore: { '13_2026-10-01': day(row(250, 0, 0, { openFixed: true })) }, __stockInit: after }, { entryStore: { '13_2026-10-01': day(row(300, 0, 0, { openFixed: true })) } })).includes('opening-locked'));
}

console.log('\nTest F — reactivating a started shop');
{
  const init = started(7);
  const entries = chainOf(7);
  // Active/inactive is a master write — no day sheet moves, so nothing is reconciled.
  const again = land(init, { ...entries }, { ...entries });
  check('Active → Inactive → Active: still started', I.isInitialized(again, 7));
  check('its first day is not rewritten', again['7'].date === '2026-09-01');
  check('while it holds stock, a new Opening is refused', kinds(judge({ entryStore: entries, __stockInit: init }, { entryStore: { ...entries, '7_2026-09-15': day(row(1200, 0, 100, { openFixed: true })) } })).includes('opening-locked'));
  check('an untouched sheet of another shop is not reconciled', I.shopsTouchedBy({ '16_2026-09-01': day(row(2268, 0, 551)) }, { '16_2026-09-01': day(row(2268, 0, 551)), '1_2026-09-18': day(row(5, 0, 0)) }).join() === '1');
}

console.log('\nClearing an Initial Opening — the shop becomes new again');
{
  // Scenario A: the only stock entry — a wrong Initial Opening on 18 Sep — is cleared.
  const wrong = { '20_2026-09-18': day(row(200, 0, 0, { openFixed: true })) };
  let init = land({}, {}, wrong, 'crs20');
  check('A: 18 Sep Initial Opening starts CRS 20 on 18 Sep', I.initialDate(init, 20) === '2026-09-18');
  check('A: the user may not key 1 Sep while it stands', kinds(judge({ entryStore: wrong, __stockInit: init }, { entryStore: { ...wrong, '20_2026-09-01': day(row(0, 0, 0)) } })).includes('before-initial-date'));
  init = land(init, wrong, {}, 'admin'); // the approved clear removed it
  check('A: after the clear CRS 20 is a new shop — no first stock date', !I.isInitialized(init, 20) && I.initialDate(init, 20) === null, JSON.stringify(init));
  check('A: other shops keep their records', I.initialDate(land(started(7), wrong, {}, 'admin'), 7) === '2026-09-01');

  // Scenario C: the user keys the Initial Opening again, on 1 Sep, and carries on.
  const first = { '20_2026-09-01': day(row(200, 0, 20, { openFixed: true })) };
  check('C: 1 Sep may now take a typed Initial Opening (200)', judge({ entryStore: {}, __stockInit: init }, { entryStore: first }).length === 0);
  init = land(init, {}, first, 'crs20');
  check('C: 1 Sep is the new first stock date', I.initialDate(init, 20) === '2026-09-01');
  const next = { ...first, '20_2026-09-02': day(row(180, 0, 5)) };
  check('C: 2 Sep opens with 1 Sep Closing (180)', judge({ entryStore: first, __stockInit: init }, { entryStore: next }).length === 0);
  check('C: … and a typed Opening on 2 Sep is refused', kinds(judge({ entryStore: first, __stockInit: init }, { entryStore: { ...first, '20_2026-09-02': day(row(300, 0, 5)) } })).includes('opening-locked'));
  check('C: the Initial Opening itself is locked again', kinds(judge({ entryStore: first, __stockInit: init }, { entryStore: { '20_2026-09-01': day(row(250, 0, 20, { openFixed: true })) } })).includes('opening-locked'));

  // Scenario B: an earlier genuine Initial Opening exists; clearing a later day changes nothing.
  const both = { '20_2026-09-01': day(row(200, 0, 20, { openFixed: true })), '20_2026-09-18': day(row(180, 0, 10)) };
  const b0 = land({}, {}, both);
  const b1 = land(b0, both, { '20_2026-09-01': both['20_2026-09-01'] }, 'admin');
  check('B: clearing 18 Sep leaves the 1 Sep Initial Opening in force', I.initialDate(b1, 20) === '2026-09-01');

  // The first day cleared while a later one stands: the first day moves to it.
  const moved = land(b0, both, { '20_2026-09-18': both['20_2026-09-18'] }, 'admin');
  check('clearing the first day moves the first stock date to the next sheet (18 Sep)', I.initialDate(moved, 20) === '2026-09-18', JSON.stringify(moved));

  // The live CRS 20 case: the 18 Sep form was emptied and saved — every figure 0.
  const zeros = { '20_2026-09-18': day(row(0, 0, 0), { remits: [{ id: 'r', amount: 1, date: '2026-09-18' }] }) };
  check('a sheet with every stock figure at 0 is not stock data', !I.sheetHasStock(zeros['20_2026-09-18']));
  check('… so saving it over the Initial Opening makes the shop new again', !I.isInitialized(land(land({}, {}, wrong), wrong, zeros, 'admin'), 20));
  check('… and it never starts a shop on its own', !I.isInitialized(land({}, {}, zeros), 20));
  check('a Monthly Entry month (projected last-day sheet) is stock data', I.sheetHasStock({ a: {}, b: {}, __projection: { source: 'monthly' } }));
}

console.log('\nTest G — an administrator corrects an earlier Opening');
{
  const entries = chainOf(7);
  // 16 Sep's Opening was wrong: the physical count was 950.
  const corrected = { ...entries, '7_2026-09-16': day(row(950, 0, 50, { openFixed: true })) };
  check('the guard accepts the correction from an administrator', judge({ entryStore: entries, __stockInit: started(7) }, { entryStore: corrected }, ADMIN).length === 0);
  check('the same correction from a shop user is refused', kinds(judge({ entryStore: entries, __stockInit: started(7) }, { entryStore: corrected })).includes('opening-locked'));
  const { entryStore: rebuilt, dates } = R.rebuildChain({ entryStore: corrected, inspectionStore: {}, receiptStore: [] }, 7, '2026-09-16');
  const r16 = rebuilt['7_2026-09-16'].a.BRA;
  const r17 = rebuilt['7_2026-09-17'].a.BRA;
  check('16 Sep keeps the corrected Opening (950) and closes at 900', r16.open === 950 && r16.close === 900, JSON.stringify(r16));
  check('17 Sep re-opens at 900, Total 900, Closing 870', r17.open === 900 && r17.total === 900 && r17.close === 870, JSON.stringify(r17));
  check('only 17 Sep needed rewriting', dates.join() === '2026-09-17', dates.join());
  check('17 Sep Sales untouched', r17.sales === 30);
  check('the rebuilt chain passes the guard for a shop user saving afterwards', judge({ entryStore: rebuilt, __stockInit: started(7) }, { entryStore: { ...rebuilt, '7_2026-09-17': day(row(900, 0, 35)) } }).length === 0);
  // A correction of 16 Sep's Closing is saved as the Opening that gives it.
  const close = 880; // wanted Closing; Sales 50, no receipt → Opening 930
  const viaClose = { ...entries, '7_2026-09-16': day(row(close + 50, 0, 50, { openFixed: true })) };
  const again = R.rebuildChain({ entryStore: viaClose, inspectionStore: {}, receiptStore: [] }, 7, '2026-09-16').entryStore;
  check('a corrected Closing (880) carries into 17 Sep', again['7_2026-09-17'].a.BRA.open === 880, JSON.stringify(again['7_2026-09-17'].a.BRA));
  check('an earlier day keyed later cannot carry a fixed Opening away', R.rebuildChain({ entryStore: { ...corrected, '7_2026-09-14': day(row(10, 0, 0)) }, inspectionStore: {}, receiptStore: [] }, 7, '2026-09-14').entryStore['7_2026-09-15'].a.BRA.open === 1000);
}

console.log('\nTest H — an administrator corrects a remittance');
{
  const txn = { id: 'rm_1', amount: 4577.5, date: '2026-09-16', account: 'nc' };
  const extra = { id: 'rm_2', amount: 120, date: '2026-09-16', account: 'nc', reason: 'Tea' };
  const sheet16 = day(row(900, 0, 50), { remits: [txn, extra], remitAmount: 4697.5, remitDate: '2026-09-16' });
  const stored = { entryStore: { ...chainOf(7), '7_2026-09-16': sheet16 }, __stockInit: started(7) };
  const edited = { ...sheet16, remits: [{ ...txn, amount: 4600, date: '2026-09-17' }, { ...extra, reason: 'Salt' }], ...M.sheetTotals([{ ...txn, amount: 4600, date: '2026-09-17' }, { ...extra, reason: 'Salt' }]) };
  const incoming = { entryStore: { ...stored.entryStore, '7_2026-09-16': edited } };
  check('an administrator may change amount, date and reason', judge(stored, incoming, ADMIN).length === 0);
  check('a shop user may not', kinds(judge(stored, incoming)).includes('remittance-locked'));
  check('a shop user may still add a deposit', judge(stored, { entryStore: { ...stored.entryStore, '7_2026-09-16': { ...sheet16, remits: [txn, extra, { id: 'rm_3', amount: 10, date: '2026-09-16', account: 'nc', reason: 'Missed' }] } } }).length === 0);
  const month = M.monthTxns(incoming.entryStore, 7, 9, 2026).filter((t) => t.salesDate === '2026-09-16');
  check('Monthly Remittance reads the corrected rows — same two, no duplicate', month.length === 2 && month[0].amount === 4600 && month[0].date === '2026-09-17' && month[1].reason === 'Salt', JSON.stringify(month));
  check('the day total follows (4720)', edited.remitAmount === 4720, String(edited.remitAmount));
}

console.log('\nBefore the started record exists at all');
{
  check('a shop with stored sheets counts as started', kinds(judge({ entryStore: chainOf(7) }, { entryStore: { ...chainOf(7), '7_2026-09-15': day(row(5, 0, 100, { openFixed: true })) } })).includes('opening-locked'));
  check('a shop with nothing stored may type its Initial Opening', judge({ entryStore: {} }, { entryStore: { '1_2026-09-18': day(row(5, 0, 0, { openFixed: true })) } }).length === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nINITIAL OPENING OK');
process.exitCode = failures ? 1 : 0;
