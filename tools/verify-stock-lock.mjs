/**
 * The stock field rules, as executable cases.
 *
 *   node tools/verify-stock-lock.mjs
 *
 * Three modules are under test and they matter for different reasons.
 *
 * src/lib/stockGuard.ts is what actually stops a shop re-keying a saved
 * Opening or inventing a Receipt — the read-only boxes on the two entry
 * screens are manners, and anyone with a session and devtools can POST past
 * them. Every case below is one a real save could hit.
 *
 * src/lib/engine/monthlyReceipt.ts is the other half: a Receipt keyed in
 * Monthly Entry becomes a register row instead of a second source of truth.
 * The cases that matter there are the ones about counting stock twice.
 *
 * src/lib/engine/receiptSync.ts is what makes a deleted receipt actually leave
 * — out of the day sheet, out of the manual month's copy of it, out of the
 * published month and out of a monthly-keyed month's projected sheet. Four
 * places hold that figure and each goes stale for its own reason.
 *
 * Runs the TypeScript source directly (Node >= 23.6 strips types).
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

const S = await import(pathToFileURL(join(root, 'src/lib/stockGuard.ts')).href);
const M = await import(pathToFileURL(join(root, 'src/lib/engine/monthlyReceipt.ts')).href);
const G = await import(pathToFileURL(join(root, 'src/lib/clearGuard.ts')).href);
const R = await import(pathToFileURL(join(root, 'src/lib/engine/receiptRollup.ts')).href);
const SY = await import(pathToFileURL(join(root, 'src/lib/engine/receiptSync.ts')).href);

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
const DAY = '1_2026-09-09';
const MONTH = '1_9_2026';

/** One commodity row that adds up: total = open+receipt, close = total−sales. */
const row = (open, receipt, sales, extra = {}) => {
  const total = open + receipt + (extra.excess ?? 0) - (extra.shortage ?? 0) - (extra.transfer ?? 0);
  return { open, receipt, total, sales, close: total - sales - (extra.cs ?? 0), amount: 0, ...extra };
};
const sheet = (r) => ({ a: { BRA: r }, b: {} });
const rcp = (id, crsId, date, items, extra = {}) => ({ id, crsId, date, receiptNo: `R/${id}`, items, ...extra });

/** Violations from one payload; `stored` and `incoming` are store maps. */
const judge = (stored, incoming, isAdmin = USER) => S.inspectStockWrite(stored, incoming, isAdmin);
const kinds = (v) => v.map((x) => x.kind).sort();

console.log('\nOpening locks once saved');
{
  const before = { entryStore: { [DAY]: sheet(row(100, 0, 40)) } };
  const after = { entryStore: { [DAY]: sheet(row(200, 0, 40)) } };
  check('shop staff cannot re-key a saved Opening', kinds(judge(before, after)).includes('opening-locked'));
  check('an administrator can', judge(before, after, ADMIN).length === 0);
  check(
    'the message names both figures',
    /100\.000.*200\.000/.test(judge(before, after).find((v) => v.kind === 'opening-locked')?.detail ?? ''),
  );
}
{
  // A saved sheet writes a row for every commodity, so a stored zero means
  // "never keyed", not "keyed as nothing".
  const before = { entryStore: { [DAY]: sheet(row(0, 0, 0)) } };
  const after = { entryStore: { [DAY]: sheet(row(500, 0, 0)) } };
  check('a stored Opening of zero is still keyable', judge(before, after).length === 0);
}
{
  const after = { entryStore: { [DAY]: sheet(row(100, 0, 40)) } };
  check('a brand-new sheet may state its Opening', judge({}, after).length === 0);
}
{
  const projected = { ...sheet(row(100, 0, 40)), __projection: { source: 'monthly', at: 'x' } };
  const before = { entryStore: { [DAY]: projected } };
  const after = { entryStore: { [DAY]: sheet(row(900, 0, 40)) } };
  check("converting Monthly Entry's projected sheet is not an Opening change", judge(before, after).length === 0);
}
{
  const before = { entryStore: { [DAY]: sheet(row(100, 0, 40)) } };
  check('an unchanged sheet passes untouched', judge(before, before).length === 0);
}

console.log('\nReceipt belongs to the Receipt Register');
{
  const after = { entryStore: { [DAY]: sheet(row(100, 500, 0)) } };
  check('shop staff cannot key a Receipt the register does not hold', kinds(judge({}, after)).includes('receipt-not-keyable'));
  check('an administrator can key one directly', judge({}, after, ADMIN).length === 0);
}
{
  const stored = { receiptStore: [rcp(1, 1, '2026-09-09', { BRA: { qty: 500 } })] };
  const after = { entryStore: { [DAY]: sheet(row(100, 500, 0)) } };
  check('a Receipt matching the register is allowed', judge(stored, after).length === 0);
  const wrong = { entryStore: { [DAY]: sheet(row(100, 600, 0)) } };
  check('...and one that does not match is refused', kinds(judge(stored, wrong)).includes('receipt-not-keyable'));
}
{
  // Saving a receipt and the day sheet that shows it is ONE post.
  const after = {
    receiptStore: [rcp(1, 1, '2026-09-09', { BRA: { qty: 500 } })],
    entryStore: { [DAY]: sheet(row(100, 500, 0)) },
  };
  check('the register is read from the same payload that writes it', judge({}, after).length === 0);
}
{
  const stored = { receiptStore: [rcp(1, 1, '2026-09-09', { BRA: { qty: 500 } })] };
  check('a receipt for another shop does not license this one', kinds(judge({ receiptStore: [rcp(1, 2, '2026-09-09', { BRA: { qty: 500 } })] }, { entryStore: { [DAY]: sheet(row(100, 500, 0)) } })).includes('receipt-not-keyable'));
  check('a receipt on another date does not either', kinds(judge({ receiptStore: [rcp(1, 1, '2026-09-08', { BRA: { qty: 500 } })] }, { entryStore: { [DAY]: sheet(row(100, 500, 0)) } })).includes('receipt-not-keyable'));
  check('the right shop and date is allowed', judge(stored, { entryStore: { [DAY]: sheet(row(100, 500, 0)) } }).length === 0);
}
{
  // Sheets keyed before this rule existed hold a hand-typed Receipt and no
  // register row. Re-saving one must not be an offence; changing it is.
  const before = { entryStore: { [DAY]: sheet(row(100, 500, 0)) } };
  const same = { entryStore: { [DAY]: sheet(row(100, 500, 90)) } };
  check('a legacy Receipt survives an edit to Sales', judge(before, same).length === 0);
  const moved = { entryStore: { [DAY]: sheet(row(100, 700, 0)) } };
  check('...but moving it is refused', kinds(judge(before, moved)).includes('receipt-not-keyable'));
}

console.log('\nTotal and Closing are arithmetic — for everyone');
{
  const bad = { entryStore: { [DAY]: { a: { BRA: { open: 100, receipt: 50, total: 900, sales: 40, close: 860, amount: 0 } }, b: {} } } };
  check('a forged Total is refused', kinds(judge({}, bad, ADMIN)).includes('total-mismatch'));
  check('...for an administrator too', judge({}, bad, ADMIN).some((v) => v.kind === 'total-mismatch'));
}
{
  const bad = { entryStore: { [DAY]: { a: { BRA: { open: 100, receipt: 0, total: 100, sales: 40, close: 999, amount: 0 } }, b: {} } } };
  check('a forged Closing is refused', kinds(judge({}, bad, ADMIN)).includes('closing-mismatch'));
}
{
  const ok = { entryStore: { [DAY]: sheet(row(100, 0, 40, { excess: 5, shortage: 2, transfer: 1 })) } };
  check('adjustments count in the Total (open+receipt+excess−shortage−transfer)', judge({}, ok, ADMIN).length === 0);
  const bad = { entryStore: { [DAY]: { a: { BRA: { open: 100, receipt: 0, total: 100, sales: 0, close: 100, excess: 5, shortage: 0, transfer: 0, amount: 0 } }, b: {} } } };
  check('...and a Total that ignores them is refused', kinds(judge({}, bad, ADMIN)).includes('total-mismatch'));
}
{
  // The imported workbook months predate all of this. An untouched one must
  // never be read back as an offence.
  const wrong = { a: { BRA: { open: 1, receipt: 1, total: 77, sales: 1, close: 77, amount: 0 } }, b: {} };
  const store = { monthlyStore: { [MONTH]: wrong } };
  check('history that does not add up passes while it is untouched', judge(store, store, ADMIN).length === 0);
}
{
  const before = { monthlyStore: { [MONTH]: { a: { BRA: { open: 1, receipt: 1, total: 77, sales: 1, close: 77, amount: 0 } }, b: {} } } };
  const after = { monthlyStore: { [MONTH]: { a: { BRA: { open: 1, receipt: 1, total: 77, sales: 2, close: 77, amount: 0 } }, b: {} } } };
  check('...and is judged the moment a figure moves', judge(before, after, ADMIN).length > 0);
}
{
  const withCs = { meManualStore: { [MONTH]: { a: { BRA: row(1000, 500, 200, { cs: 50 }) }, b: {} } } };
  check('C.S counts in the monthly Closing (total−sales−cs)', judge({}, withCs, ADMIN).length === 0);
}
{
  const projected = { a: { BRA: { open: 1000, receipt: 500, total: 1500, sales: 200, close: 1250, amount: 0 } }, b: {} };
  projected.__projection = { source: 'monthly', at: 'x' };
  // 1500 − 200 = 1300, but the month took 50 of C.S off, which a day sheet has
  // no column for. Its Total is still checked.
  check("a projected sheet's Closing carries the month's C.S and is not judged", judge({}, { entryStore: { [DAY]: projected } }, ADMIN).length === 0);
  const forged = { ...projected, a: { BRA: { ...projected.a.BRA, total: 9999 } } };
  check("...but its Total still is", kinds(judge({}, { entryStore: { [DAY]: forged } }, ADMIN)).includes('total-mismatch'));
}

console.log('\nWhich stores each rule reaches');
{
  const after = { meManualStore: { [MONTH]: { a: { BRA: row(100, 500, 0) } }, b: {} } };
  check('Monthly Entry Receipt is register-checked too', kinds(judge({}, after)).includes('receipt-not-keyable'));
  const stored = { receiptStore: [rcp(1, 1, '2026-09-30', { BRA: { qty: 500 } })] };
  check('...against the whole MONTH of receipts, not one day', judge(stored, after).length === 0);
  const split = { receiptStore: [rcp(1, 1, '2026-09-03', { BRA: { qty: 200 } }), rcp(1, 1, '2026-09-21', { BRA: { qty: 300 } })] };
  check('...summed across the month', judge(split, after).length === 0);
  const other = { receiptStore: [rcp(1, 1, '2026-08-30', { BRA: { qty: 500 } })] };
  check('...and a receipt in another month does not count', kinds(judge(other, after)).includes('receipt-not-keyable'));
}
{
  const before = { meManualStore: { [MONTH]: { a: { BRA: row(1000, 0, 0) }, b: {} } } };
  const after = { meManualStore: { [MONTH]: { a: { BRA: row(2000, 0, 0) }, b: {} } } };
  check('Monthly Opening locks once saved', kinds(judge(before, after)).includes('opening-locked'));
  check('...and an administrator can still correct it', judge(before, after, ADMIN).length === 0);
}
{
  // monthlyStore is the roll-up's OUTPUT. Locking Opening or Receipt there
  // would refuse the roll-up's own writes.
  const before = { monthlyStore: { [MONTH]: { a: { BRA: row(1000, 0, 0) }, b: {} } } };
  const after = { monthlyStore: { [MONTH]: { a: { BRA: row(2000, 700, 0) }, b: {} } } };
  check('the published month is arithmetic-only — no Opening or Receipt lock', judge(before, after).length === 0);
}
{
  check('a key that is not a shop-day is ignored', judge({}, { entryStore: { __somethingElse: sheet(row(1, 2, 3)) } }).length === 0);
  check('a key that is not a shop-month is ignored', judge({}, { meManualStore: { nonsense: { a: { BRA: row(1, 2, 3) }, b: {} } } }).length === 0);
}
{
  check('a store nobody guards is not inspected', judge({}, { meGunnyStore: { [MONTH]: { GUNNY: { open: 5 } } } }).length === 0);
}

console.log('\nMonthly Entry Receipt → the Receipt Register');
{
  const plan = M.planMonthlyReceipt([], 1, 9, 2026, { BRA: 1000 }, 7);
  check('an empty register takes the whole figure', plan.action === 'created' && plan.row.items.BRA.qty === 1000);
  check('...dated the last day of the month', plan.row.date === '2026-09-30');
  check('...with a reference naming the shop and month', plan.row.receiptNo === 'ME/1/09/2026');
  check('...and marked as the app’s own row', plan.row.source === 'monthly-entry' && M.isMonthlyReceipt(plan.row));
  check('...taking the next free receipt id', plan.row.id === 7 && plan.nextId === 8);
}
{
  // The month's Receipt is the TOTAL. Real receipts are inside it, so writing
  // the whole figure again would count them twice.
  const store = [rcp(1, 1, '2026-09-04', { BRA: { qty: 300 } })];
  const plan = M.planMonthlyReceipt(store, 1, 9, 2026, { BRA: 1000 }, 2);
  check('an existing receipt is subtracted, not added to', plan.row.items.BRA.qty === 700);
  const total = S.registerMonth(plan.rows, 1, 9, 2026).BRA;
  check('the register month total equals the keyed month figure', Math.abs(total - 1000) < 1e-9, `got ${total}`);
}
{
  const first = M.planMonthlyReceipt([], 1, 9, 2026, { BRA: 1000 }, 1);
  const again = M.planMonthlyReceipt(first.rows, 1, 9, 2026, { BRA: 1000 }, first.nextId);
  check('saving the same month twice writes nothing', again.action === 'unchanged');
  check('...and does not stack a second row', again.rows.length === 1);
  check('...leaving the array identical so no audit row is written', again.rows === first.rows);
}
{
  const first = M.planMonthlyReceipt([], 1, 9, 2026, { BRA: 1000 }, 1);
  const edited = M.planMonthlyReceipt(first.rows, 1, 9, 2026, { BRA: 1200 }, first.nextId);
  check('correcting the figure rewrites the same row', edited.action === 'updated' && edited.rows.length === 1);
  check('...keeping its id', edited.row.id === first.row.id);
  check('...and not burning a new one', edited.nextId === first.nextId);
  check('...to the new figure', edited.row.items.BRA.qty === 1200);
}
{
  const first = M.planMonthlyReceipt([], 1, 9, 2026, { BRA: 1000 }, 1);
  const cleared = M.planMonthlyReceipt(first.rows, 1, 9, 2026, {}, first.nextId);
  check('clearing the month’s Receipt removes the row', cleared.action === 'removed' && cleared.rows.length === 0);
}
{
  // The register is the record of what arrived; the month cannot claim less.
  const store = [rcp(1, 1, '2026-09-04', { BRA: { qty: 1200 } })];
  const plan = M.planMonthlyReceipt(store, 1, 9, 2026, { BRA: 1000 }, 2);
  check('a month claiming less than the register holds writes no row', plan.action === 'unchanged' && plan.rows.length === 1);
  check('...and says so', plan.over.length === 1 && plan.over[0].keyed === 1200 && plan.over[0].wanted === 1000);
  check('...never a negative receipt', !plan.rows.some((r) => Object.values(r.items).some((i) => i.qty < 0)));
}
{
  const store = [rcp(9, 1, '2026-09-30', { BRA: { qty: 400 } }, { source: 'monthly-entry' }), rcp(8, 1, '2026-09-02', { BRA: { qty: 100 } })];
  const keyed = M.keyedReceiptTotals(store, 1, 9, 2026);
  check('the generated row is not counted against itself', keyed.BRA === 100);
}
{
  const store = [
    rcp(1, 1, '2026-09-30', { BRA: { qty: 400 } }, { source: 'monthly-entry' }),
    rcp(2, 2, '2026-09-30', { BRA: { qty: 400 } }, { source: 'monthly-entry' }),
    rcp(3, 1, '2026-08-31', { BRA: { qty: 400 } }, { source: 'monthly-entry' }),
    rcp(4, 1, '2026-09-02', { BRA: { qty: 100 } }),
  ];
  const { rows, dropped } = M.dropMonthlyReceipt(store, 1, 9, 2026);
  check('the two-mode switch drops only this shop-month’s generated row', dropped && rows.length === 3);
  check('...leaving another shop’s alone', rows.some((r) => r.id === 2));
  check('...another month’s alone', rows.some((r) => r.id === 3));
  check('...and every real receipt alone', rows.some((r) => r.id === 4));
  check('dropping when there is nothing to drop is a no-op', M.dropMonthlyReceipt(rows, 1, 9, 2026).dropped === false);
}

console.log('\nA receipt keyed after the day sheet lands on it');
{
  const before = [];
  const after = [rcp(1, 1, '2026-09-09', { BRA: { qty: 500 } })];
  const saved = { a: { BRA: row(1000, 0, 250) }, b: {} };
  const next = R.syncSheetReceipts(saved, before, after, 1, '2026-09-09');
  check('the stored sheet takes the register’s figure', next.a.BRA.receipt === 500);
  check('...and its Total follows', next.a.BRA.total === 1500);
  check('...and its Closing, which is what tomorrow’s Opening carries', next.a.BRA.close === 1250);
  check('...leaving Opening and Sales alone', next.a.BRA.open === 1000 && next.a.BRA.sales === 250);
  check('the result passes the guard that judges every save', judge({ entryStore: { [DAY]: saved }, receiptStore: before }, { entryStore: { [DAY]: next }, receiptStore: after }).length === 0);
}
{
  const saved = { a: { BRA: row(1000, 0, 0), SUGAR: row(20, 7, 0) }, b: {} };
  const next = R.syncSheetReceipts(saved, [], [rcp(1, 1, '2026-09-09', { BRA: { qty: 500 } })], 1, '2026-09-09');
  check('a commodity the register never mentioned keeps its keyed Receipt', next.a.SUGAR.receipt === 7);
}
{
  const had = [rcp(1, 1, '2026-09-09', { BRA: { qty: 500 } })];
  const saved = { a: { BRA: row(1000, 500, 250) }, b: {} };
  const next = R.syncSheetReceipts(saved, had, [], 1, '2026-09-09');
  check('deleting the receipt takes the figure back off the sheet', next.a.BRA.receipt === 0);
  check('...and re-closes the day at 750', next.a.BRA.total === 1000 && next.a.BRA.close === 750);
}
{
  const saved = { a: { BRA: row(1000, 0, 250, { excess: 5, shortage: 2, transfer: 1 }) }, b: {} };
  const next = R.syncSheetReceipts(saved, [], [rcp(1, 1, '2026-09-09', { BRA: { qty: 500 } })], 1, '2026-09-09');
  check('adjustments still count in the recomputed Total', next.a.BRA.total === 1000 + 500 + 5 - 2 - 1);
}
{
  const projected = { a: { BRA: row(1000, 0, 250) }, b: {}, __projection: { source: 'monthly', at: 'x' } };
  check(
    'a projected sheet is left alone — it states the whole month',
    R.syncSheetReceipts(projected, [], [rcp(1, 1, '2026-09-30', { BRA: { qty: 500 } })], 1, '2026-09-30') === null,
  );
  check('nothing to do returns null', R.syncSheetReceipts({ a: { BRA: row(1, 0, 0) }, b: {} }, [], [], 1, '2026-09-09') === null);
  check('no sheet returns null', R.syncSheetReceipts(undefined, [], [rcp(1, 1, '2026-09-09', { BRA: { qty: 5 } })], 1, '2026-09-09') === null);
}

console.log('\nDeleting a receipt takes its figure out of Daily and Monthly');
{
  // The reported case: a monthly-keyed month whose Receipt came from the
  // register, saved (so meManualStore holds a copy), then the receipt deleted.
  const mrec = (open, receipt, sales) => {
    const total = open + receipt;
    return { open, receipt, total, sales, close: total - sales, amount: 0, excess: 0, shortage: 0, transfer: 0, cs: 0, g_cs: 0,
      g_open: open / 50, g_receipt: receipt / 50, g_total: total / 50, g_sales: sales / 50, g_close: (total - sales) / 50 };
  };
  const had = [rcp(15, 1, '2026-09-09', { BRA: { qty: 1000 } })];
  const projection = { a: { BRA: row(1000, 1000, 1000) }, b: {}, __projection: { source: 'monthly', at: '2026-09-09T10:00:00Z' } };
  const stores = () => ({
    entryStore: { '1_2026-09-30': JSON.parse(JSON.stringify(projection)) },
    inspectionStore: {},
    meManualStore: { '1_9_2026': { a: { BRA: mrec(1000, 1000, 1000) }, b: {} } },
    meSourceStore: { '1_9_2026': { a: { BRA: 'receipt' }, b: {} } },
    monthlyStore: { '1_9_2026': { a: { BRA: mrec(1000, 1000, 1000) }, b: {} } },
    receiptStore: [],
  });

  const s = stores();
  const patch = SY.resyncReceiptMonth(s, 1, 9, 2026, { dateIso: '2026-09-09', before: had });
  const man = patch.meManualStore['1_9_2026'].a.BRA;
  const mon = patch.monthlyStore['1_9_2026'].a.BRA;
  const proj = patch.entryStore['1_2026-09-30'].a.BRA;

  check('the manual month lets go of the register’s figure', man.receipt === 0);
  check('Monthly Receipt becomes 0', mon.receipt === 0);
  check('Monthly Total falls back to Opening (1000)', mon.total === 1000);
  check('Monthly Closing becomes Total − Sales = 0', mon.close === 0);
  check('the bag counts follow', man.g_receipt === 0 && man.g_total === 20 && man.g_close === 0);
  check('the row stops being register-sourced', patch.meSourceStore['1_9_2026'].a.BRA === 'manual');
  check('the projected day sheet the DSS prints is rewritten', proj.receipt === 0 && proj.total === 1000 && proj.close === 0);
  check('...and stays a projection, recorded at the time the clerk closed the month',
    patch.entryStore['1_2026-09-30'].__projection.at === '2026-09-09T10:00:00Z');
  check('Opening and Sales are untouched', mon.open === 1000 && mon.sales === 1000);

  // Running it a second time must find nothing left to do.
  const again = SY.resyncReceiptMonth({ ...s, ...patch }, 1, 9, 2026);
  check('a second pass changes nothing', again.meManualStore === undefined);
}
{
  // "Do not reset the full Receipt value to zero unless no Receipt records remain."
  const before = [rcp(1, 1, '2026-09-04', { BRA: { qty: 500 } }), rcp(2, 1, '2026-09-18', { BRA: { qty: 300 } })];
  const after = [before[1]];
  const rec = { open: 0, receipt: 800, total: 800, sales: 0, close: 800, amount: 0, excess: 0, shortage: 0, transfer: 0 };
  const patch = SY.resyncReceiptMonth(
    { entryStore: {}, inspectionStore: {}, meManualStore: { '1_9_2026': { a: { BRA: rec }, b: {} } },
      meSourceStore: { '1_9_2026': { a: { BRA: 'receipt' }, b: {} } }, monthlyStore: {}, receiptStore: after },
    1, 9, 2026, { dateIso: '2026-09-04', before },
  );
  check('deleting one of two receipts leaves the other', patch.monthlyStore['1_9_2026'].a.BRA.receipt === 300);
  check('...and does not reset the month to zero', patch.meManualStore['1_9_2026'].a.BRA.receipt === 300);
}
{
  // A Receipt keyed by hand into a month the register never spoke for is
  // somebody's own work, not a copy of anything.
  const rec = { open: 100, receipt: 400, total: 500, sales: 0, close: 500, amount: 0, excess: 0, shortage: 0, transfer: 0 };
  const patch = SY.resyncReceiptMonth(
    { entryStore: {}, inspectionStore: {}, meManualStore: { '1_9_2026': { a: { BRA: rec }, b: {} } },
      meSourceStore: { '1_9_2026': { a: { BRA: 'manual' }, b: {} } }, monthlyStore: {}, receiptStore: [] },
    1, 9, 2026,
  );
  check('a hand-keyed monthly Receipt is left alone', patch.meManualStore === undefined);
  check('...and still publishes', patch.monthlyStore['1_9_2026'].a.BRA.receipt === 400);
}
{
  // The admin monthly-only flow: the generated row IS the month's receipt.
  const gen = rcp(9, 1, '2026-09-30', { BRA: { qty: 500 } }, { source: 'monthly-entry' });
  const rec = { open: 1000, receipt: 500, total: 1500, sales: 1200, close: 300, amount: 0, excess: 0, shortage: 0, transfer: 0 };
  const patch = SY.resyncReceiptMonth(
    { entryStore: { '1_2026-09-30': { a: { BRA: row(1000, 500, 1200) }, b: {}, __projection: { source: 'monthly', at: 'x' } } },
      inspectionStore: {}, meManualStore: { '1_9_2026': { a: { BRA: rec }, b: {} } },
      meSourceStore: { '1_9_2026': { a: { BRA: 'receipt' }, b: {} } }, monthlyStore: {}, receiptStore: [] },
    1, 9, 2026, { dateIso: '2026-09-30', before: [gen] },
  );
  check('deleting the generated register row empties the month it stood for', patch.monthlyStore['1_9_2026'].a.BRA.receipt === 0);
  check('...and the day sheet it printed from', patch.entryStore['1_2026-09-30'].a.BRA.receipt === 0);
}
{
  // A day-keyed month: the sheet for the receipt's own date is what changes.
  const had = [rcp(1, 1, '2026-09-09', { BRA: { qty: 500 } })];
  const patch = SY.resyncReceiptMonth(
    { entryStore: { '1_2026-09-09': { a: { BRA: row(1000, 500, 250) }, b: {} } }, inspectionStore: {},
      meManualStore: {}, meSourceStore: {}, monthlyStore: {}, receiptStore: [] },
    1, 9, 2026, { dateIso: '2026-09-09', before: had },
  );
  const day = patch.entryStore['1_2026-09-09'].a.BRA;
  check('the real day sheet drops the receipt', day.receipt === 0 && day.total === 1000 && day.close === 750);
  check('...and the month follows it', patch.monthlyStore['1_9_2026'].a.BRA.receipt === 0);
  check('the resync’s own output passes the guard that judges every save',
    judge({ entryStore: { [DAY]: { a: { BRA: row(1000, 500, 250) }, b: {} } }, receiptStore: had },
          { entryStore: patch.entryStore, receiptStore: [] }).length === 0);
}
{
  // Nothing keyed but the receipt: with it gone the month has nothing to say.
  const patch = SY.resyncReceiptMonth(
    { entryStore: { '1_2026-09-30': { a: { BRA: row(0, 500, 0) }, b: {}, __projection: { source: 'monthly', at: 'x' } } },
      inspectionStore: {}, meManualStore: {}, meSourceStore: {},
      monthlyStore: { '1_9_2026': { a: { BRA: row(0, 500, 0) }, b: {} } }, receiptStore: [] },
    1, 9, 2026, { dateIso: '2026-09-30', before: [rcp(1, 1, '2026-09-30', { BRA: { qty: 500 } })] },
  );
  check('an empty month is unpublished rather than left at zero', patch.monthlyStore['1_9_2026'] === undefined);
  check('...and its projected sheet goes with it', patch.entryStore['1_2026-09-30'] === undefined);
}

console.log('\nThe clear guard knows the generated row is the app’s');
{
  const gen = rcp(1, 1, '2026-09-30', { BRA: { qty: 400 } }, { source: 'monthly-entry' });
  const real = rcp(2, 1, '2026-09-02', { BRA: { qty: 100 } });
  const before = [gen, real];
  check(
    'a shop keying its first day sheet may drop the generated row',
    G.diffStore('receiptStore', before, [real], 1).destructive.length === 0,
  );
  check(
    '...but deleting a real receipt still needs approval',
    G.diffStore('receiptStore', before, [gen], 1).destructive.length === 1,
  );
  check(
    '...and it is still scope-checked',
    G.diffStore('receiptStore', before, [real], 9).foreign.length === 1,
  );
}

console.log(`\n${failures ? `${failures} FAILED` : 'STOCK LOCK OK'}`);
process.exit(failures ? 1 : 0);
