/**
 * The Opening → Closing chain in DATE order, as executable cases.
 *
 *   node tools/verify-chain-rebuild.mjs
 *
 * One rule (src/lib/engine/rechain.ts): only a day with nothing earlier to
 * carry from keeps a typed Opening; every other day opens with the previous
 * applicable day's Closing — plus receipts and inspection on the sheet-less
 * days between — whatever order the days were keyed in.
 *
 * The reported case comes first, with its own figures: CRS 7, September 2026,
 * the 16th keyed first with an Opening of 200, then the real first day, the
 * 2nd, keyed later with 200 — after which the 16th must open at 125.
 *
 * Every rebuilt row is checked with the stock guard's arithmetic, not with the
 * code under test, and the stock guard itself is asked whether a shop user may
 * save the result.
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

const { rebuildChain, rechainAndRepublish } = await import(pathToFileURL(join(root, 'src/lib/engine/rechain.ts')).href);
const { expectedTotal, expectedClose, inspectStockWrite, TOLERANCE } = await import(pathToFileURL(join(root, 'src/lib/stockGuard.ts')).href);

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

/** A row as Daily Entry saves it: it adds up, whatever Opening it was given. */
const row = (open, sales, extra = {}) => {
  const receipt = extra.receipt ?? 0;
  const excess = extra.excess ?? 0;
  const shortage = extra.shortage ?? 0;
  const transfer = extra.transfer ?? 0;
  const total = open + receipt + excess - shortage - transfer;
  return { open, receipt, total, sales, close: total - sales, amount: 0, excess, shortage, transfer };
};
const sheet = (bra, extra = {}) => ({ a: { BRA: bra }, b: {}, remitAmount: 1, ...extra });
const adds = (r) => Math.abs(r.total - expectedTotal(r)) <= TOLERANCE && Math.abs(r.close - expectedClose(r)) <= TOLERANCE;
const bra = (store, key) => store[key]?.a?.BRA;

console.log('\nThe reported case — CRS 7, September 2026');
{
  // Step 1: the 16th is keyed first. Nothing earlier exists, so its Opening is typed.
  const first = { '7_2026-09-16': sheet(row(200, 20)) };
  const alone = rebuildChain({ entryStore: first, inspectionStore: {}, receiptStore: [] }, 7, '2026-09-16');
  check('keyed alone, the 16th is the start of the chain and keeps its typed 200', alone.dates.length === 0 && bra(alone.entryStore, '7_2026-09-16').open === 200);

  // Step 2: the real first day is keyed afterwards, and the days after it —
  // with gaps: no sheet on the 4th, 6th, 7th, 9th or 11th–14th.
  const stores = {
    entryStore: {
      ...clone(first),
      '7_2026-09-02': sheet(row(200, 20)),
      '7_2026-09-03': sheet(row(180, 30)),
      '7_2026-09-05': sheet(row(150, 10)),
      '7_2026-09-08': sheet(row(140, 5)),
      '7_2026-09-10': sheet(row(135, 5)),
      '7_2026-09-15': sheet(row(130, 5)),
      '17_2026-09-16': sheet(row(999, 9)),
    },
    inspectionStore: {},
    receiptStore: [],
  };
  const r = rebuildChain(stores, 7, '2026-09-02');
  const d16 = bra(r.entryStore, '7_2026-09-16');
  check('the 2nd keeps its typed 200 — it is the earliest day now', bra(r.entryStore, '7_2026-09-02').open === 200);
  check('the 16th no longer keeps 200: it opens at the 15th’s Closing, 125', d16.open === 125, `got ${d16.open}`);
  check('...and its Total and Closing follow: 125, 105', d16.total === 125 && d16.close === 105, `got ${d16.total} / ${d16.close}`);
  check('only the 16th changed', same(r.dates, ['2026-09-16']), r.dates.join(', '));
  check('another shop’s 16th is untouched', same(r.entryStore['17_2026-09-16'], stores.entryStore['17_2026-09-16']));

  const days = Object.keys(r.entryStore).filter((k) => k.startsWith('7_')).sort();
  let chained = true;
  for (let i = 1; i < days.length; i++) {
    if (bra(r.entryStore, days[i]).open !== bra(r.entryStore, days[i - 1]).close) chained = false;
  }
  check('every day now opens at the previous applicable day’s Closing, gaps stepped over', chained);
  check('every row adds up: Opening + Receipt = Total, Total − Sales = Closing', days.every((k) => adds(bra(r.entryStore, k))));

  const again = rebuildChain({ ...stores, entryStore: r.entryStore }, 7, '2026-09-02');
  check('rebuilding again changes nothing', again.dates.length === 0);

  const full = rechainAndRepublish({ ...clone(stores), meManualStore: {}, meSourceStore: {}, monthlyStore: {} }, 7, '2026-09-02');
  const month = full.patch.monthlyStore?.['7_9_2026']?.a?.BRA;
  check('Monthly Sales is republished from the rebuilt days: opens 200, sells 95, closes 105',
    month?.open === 200 && month?.sales === 95 && month?.close === 105, JSON.stringify(month));

  // A shop user saving this is not re-keying a locked Opening.
  const user = inspectStockWrite({ entryStore: stores.entryStore, receiptStore: [], inspectionStore: {} }, { entryStore: r.entryStore }, false);
  check('the stock guard lets a shop user save the rebuilt 16th', !user.some((v) => v.kind === 'opening-locked'), JSON.stringify(user));
  const forged = clone(r.entryStore);
  forged['7_2026-09-16'].a.BRA = row(150, 20);
  const refused = inspectStockWrite({ entryStore: stores.entryStore, receiptStore: [], inspectionStore: {} }, { entryStore: forged }, false);
  check('...but not to move it to any other figure', refused.some((v) => v.kind === 'opening-locked' && v.key === '7_2026-09-16'));
  const start = clone(r.entryStore);
  start['7_2026-09-02'].a.BRA = row(300, 20);
  const startMoved = inspectStockWrite({ entryStore: r.entryStore, receiptStore: [], inspectionStore: {} }, { entryStore: start }, false);
  check('...nor re-key the saved start of the chain', startMoved.some((v) => v.kind === 'opening-locked' && v.key === '7_2026-09-02'));
}

console.log('\nThe second report — CRS 7, 16 Sep → 17 Sep, a stale saved Closing');
{
  // What the database held: 15 Sep closes NPHH FRK at 3780. 16 Sep was keyed
  // before the chain rule and still stores its typed Opening 538 and Closing
  // 100, though its screen showed 3780 − 438 = 3342. 17 Sep has no sheet yet.
  const stored = {
    '7_2026-09-15': { a: { NPHH_FRK: row(3780, 0), PHH_FRK: row(1060, 0) }, b: {} },
    '7_2026-09-16': { a: { NPHH_FRK: { ...row(538, 438), close: 100 }, PHH_FRK: { ...row(685, 125), close: 560 } }, b: {} },
  };
  const { buildChainIndex, openingFor, closingAsAt } = await import(pathToFileURL(join(root, 'src/lib/engine/stockChain.ts')).href);
  const ix = buildChainIndex(stored, {}, [], 7);
  check('17 Sep NPHH FRK opens at 16 Sep’s calculated Closing, 3342 — not the stale 100 on the sheet',
    openingFor(ix, '2026-09-17', 'NPHH_FRK', 'a').value === 3342, String(openingFor(ix, '2026-09-17', 'NPHH_FRK', 'a').value));
  check('...and PHH FRK at 1060 − 125 = 935, not 560', openingFor(ix, '2026-09-17', 'PHH_FRK', 'a').value === 935);
  check('the Dashboard’s closing stock as at 16 Sep agrees: 3342', closingAsAt(ix, '2026-09-16', 'NPHH_FRK', 'a').value === 3342);

  const fixed = rebuildChain({ entryStore: stored, inspectionStore: {}, receiptStore: [] }, 7, '0000-00-00');
  const d16 = fixed.entryStore['7_2026-09-16'].a;
  check('the repair writes 16 Sep NPHH FRK as Opening 3780, Total 3780, Closing 3342', d16.NPHH_FRK.open === 3780 && d16.NPHH_FRK.total === 3780 && d16.NPHH_FRK.close === 3342);
  check('...PHH FRK as 1060 → 935', d16.PHH_FRK.open === 1060 && d16.PHH_FRK.close === 935);
  check('...keeping the Sales exactly as keyed (438, 125)', d16.NPHH_FRK.sales === 438 && d16.PHH_FRK.sales === 125);
  check('...and leaves 15 Sep alone', fixed.dates.join() === '2026-09-16');
  const after = buildChainIndex(fixed.entryStore, {}, [], 7);
  check('after the repair the stored Closing IS the carry', d16.NPHH_FRK.close === openingFor(after, '2026-09-17', 'NPHH_FRK', 'a').value);

  const arith = rebuildChain({ entryStore: { '7_2026-09-01': { a: { BRA: { open: 100, receipt: 0, total: 90, sales: 10, close: 50 } }, b: {} } }, inspectionStore: {}, receiptStore: [] }, 7, '0000-00-00');
  check('the start of the chain keeps its typed Opening but its Total and Closing are corrected: 100 → 90',
    arith.entryStore['7_2026-09-01'].a.BRA.open === 100 && arith.entryStore['7_2026-09-01'].a.BRA.total === 100 && arith.entryStore['7_2026-09-01'].a.BRA.close === 90);

  const withRcp = rebuildChain(
    { entryStore: { '7_2026-09-01': sheet(row(100, 0)), '7_2026-09-02': sheet(row(100, 10)) }, inspectionStore: {}, receiptStore: [{ id: 9, crsId: 7, date: '2026-09-01', items: { BRA: { qty: 50 } } }] },
    7, '0000-00-00',
  );
  check('a receipt added to an earlier day: that day takes the register’s 50 and the next day opens at 150',
    withRcp.entryStore['7_2026-09-01'].a.BRA.receipt === 50 && withRcp.entryStore['7_2026-09-01'].a.BRA.close === 150 && withRcp.entryStore['7_2026-09-02'].a.BRA.open === 150);
}

console.log('\nMissing dates carry the latest earlier Closing');
{
  const base = { '8_2026-09-08': sheet(row(600, 100)), '8_2026-09-10': sheet(row(0, 0)) };
  const r = rebuildChain({ entryStore: base, inspectionStore: {}, receiptStore: [] }, 8, '2026-09-01');
  check('8th closes at 500, no sheet on the 9th → the 10th opens at 500, not 0', bra(r.entryStore, '8_2026-09-10').open === 500);

  const withReceipt = rebuildChain(
    { entryStore: base, inspectionStore: {}, receiptStore: [{ id: 1, crsId: 8, date: '2026-09-09', items: { BRA: { qty: 100 } } }] },
    8, '2026-09-01',
  );
  check('a delivery on the sheet-less 9th is carried in: the 10th opens at 600', bra(withReceipt.entryStore, '8_2026-09-10').open === 600);

  const withInsp = rebuildChain({ entryStore: base, inspectionStore: { '8_2026-09-09': { a: { BRA: { shortage: 20 } } } }, receiptStore: [] }, 8, '2026-09-01');
  check('a shortage on the sheet-less 9th is carried in: the 10th opens at 480', bra(withInsp.entryStore, '8_2026-09-10').open === 480);
}

console.log('\nA change to an earlier day flows forward');
{
  const stores = () => ({
    entryStore: {
      '9_2026-09-01': sheet(row(1000, 100)),
      '9_2026-09-02': sheet(row(900, 100)),
      '9_2026-09-03': sheet(row(800, 100)),
      '9_2026-09-30': sheet(row(700, 100)),
      '9_2026-10-01': sheet(row(600, 100)),
    },
    inspectionStore: {},
    receiptStore: [],
  });

  const sales = stores();
  sales.entryStore['9_2026-09-02'] = sheet(row(900, 150)); // re-keyed: sales 100 → 150
  const r1 = rebuildChain(sales, 9, '2026-09-02');
  check('re-keyed Sales on the 2nd: the 3rd opens 50 lower, at 750', bra(r1.entryStore, '9_2026-09-03').open === 750);
  check('...the 30th at 650, and across the month end 1 Oct at 550',
    bra(r1.entryStore, '9_2026-09-30').open === 650 && bra(r1.entryStore, '9_2026-10-01').open === 550);
  check('...every day after the change, in date order', same(r1.dates, ['2026-09-03', '2026-09-30', '2026-10-01']));

  const receipt = stores();
  receipt.receiptStore = [{ id: 5, crsId: 9, date: '2026-09-02', items: { BRA: { qty: 40 } } }];
  receipt.entryStore['9_2026-09-02'] = sheet(row(900, 100, { receipt: 40 })); // the sheet shows the register's 40
  const r2 = rebuildChain(receipt, 9, '2026-09-02');
  check('a receipt on the 2nd: the 3rd opens 40 higher, at 840', bra(r2.entryStore, '9_2026-09-03').open === 840);

  const insp = stores();
  insp.inspectionStore = { '9_2026-09-02': { a: { BRA: { excess: 25 } } } };
  const r3 = rebuildChain(insp, 9, '2026-09-02');
  const d2 = bra(r3.entryStore, '9_2026-09-02');
  check('an inspection on a day with a sheet: that day takes the adjustment — Total 925, Closing 825', d2.excess === 25 && d2.total === 925 && d2.close === 825);
  check('...and the next day opens at 825', bra(r3.entryStore, '9_2026-09-03').open === 825);

  const cleared = stores();
  delete cleared.entryStore['9_2026-09-02'];
  const r4 = rebuildChain(cleared, 9, '2026-09-02');
  check('a day cleared: the 3rd opens at the 1st’s Closing, 900', bra(r4.entryStore, '9_2026-09-03').open === 900);

  const all = [r1, r2, r3, r4].flatMap((r) => Object.entries(r.entryStore).map(([, s]) => s.a.BRA));
  check('every rebuilt row adds up', all.every(adds));
}

console.log('\nWhat is never rewritten');
{
  const stores = {
    entryStore: {
      '10_2026-08-31': { a: { BRA: row(400, 100) }, b: {}, __projection: { source: 'monthly', at: 'x' } },
      '10_2026-09-02': sheet(row(200, 20)),
    },
    inspectionStore: {},
    receiptStore: [],
  };
  const r = rebuildChain(stores, 10, '2026-08-01');
  check('a month keyed by month is a carry source: 2 Sep opens at its 300', bra(r.entryStore, '10_2026-09-02').open === 300);
  check('...but the projected sheet itself is never rewritten', same(r.entryStore['10_2026-08-31'], stores.entryStore['10_2026-08-31']));

  const before = rebuildChain({ entryStore: { '11_2026-09-05': sheet(row(50, 5)), '11_2026-09-09': sheet(row(45, 5)) }, inspectionStore: {}, receiptStore: [] }, 11, '2026-09-06');
  check('days before the changed date are not visited', before.dates.length === 0);
}

console.log(`\n${failures ? `${failures} FAILED` : 'CHAIN REBUILD OK'}`);
process.exitCode = failures ? 1 : 0;
