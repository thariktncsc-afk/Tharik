/**
 * The stock chain, as executable cases.
 *
 *   node tools/verify-stock-chain.mjs
 *
 * One rule: today's closing is tomorrow's opening, with no break. The carry
 * used to read the last SAVED SHEET's closing and nothing else, which was
 * right while a sheet was the only way stock could move. It stopped being
 * right when the Receipt Register began feeding Daily Entry — a godown
 * delivery moves stock on a day nobody keyed a sheet for, and the old carry
 * stepped straight over it.
 *
 * Every case below is a shape a real shop-month produces. The reported one is
 * first, with the reporter's own figures.
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

const C = await import(pathToFileURL(join(root, 'src/lib/engine/stockChain.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const CRS = 19;
/** A saved day sheet for one commodity. */
const sheet = (open, receipt, sales, extra = {}) => {
  const total = open + receipt + (extra.excess ?? 0) - (extra.shortage ?? 0) - (extra.transfer ?? 0);
  return { a: { BRA: { open, receipt, total, sales, close: total - sales, amount: 0, ...extra } }, b: {} };
};
const rcp = (id, date, qty, crsId = CRS) => ({ id, crsId, date, receiptNo: `R/${id}`, items: { BRA: { qty } } });
const insp = (excess = 0, shortage = 0, transfer = 0) => ({ a: { BRA: { excess, shortage, transfer } }, b: {} });
const ix = (entry, inspection, receipts, crsId = CRS) => C.buildChainIndex(entry, inspection, receipts, crsId);
const open = (i, d) => C.openingFor(i, d, 'BRA', 'a');
const close = (i, d) => C.closingAsAt(i, d, 'BRA', 'a');

console.log('\nthe reported case — a receipt on a day with no sheet');
{
  // 8 Sept closes at 918. 3224 kg arrives on the 9th. Nobody keys the 9th.
  const i = ix(
    { [`${CRS}_2026-09-08`]: sheet(918, 0, 0) },
    {},
    [rcp(1, '2026-09-09', 3224)],
  );
  const o = open(i, '2026-09-10');
  check('10 Sept opens at 4142, not 918', o.value === 4142, `got ${o.value}`);
  check('...carried from the 8 Sept sheet', o.from?.date === '2026-09-08' && o.from.close === 918);
  check('...with the 9th’s delivery picked up', o.received === 3224);
  check('...and the 9th named as the day stock moved', o.movedOn.join() === '2026-09-09');
  check('the 9th itself still opens at 918', open(i, '2026-09-09').value === 918);
  check('the 9th closes at 4142 (918 + 3224 − 0 sales)', close(i, '2026-09-09').value === 4142);
}
{
  // Once the 9th IS keyed, its own closing is the carry — the receipt must not
  // be counted a second time on top of the sheet that already states it.
  const i = ix(
    { [`${CRS}_2026-09-08`]: sheet(918, 0, 0), [`${CRS}_2026-09-09`]: sheet(918, 3224, 0) },
    {},
    [rcp(1, '2026-09-09', 3224)],
  );
  const o = open(i, '2026-09-10');
  check('a keyed day is the carry, and its receipt is not added twice', o.value === 4142, `got ${o.value}`);
  check('...the gap contributes nothing', o.received === 0 && o.movedOn.length === 0);
}

console.log('\nthe chain keeps running');
{
  const i = ix(
    { [`${CRS}_2026-09-08`]: sheet(918, 0, 0) },
    {},
    [rcp(1, '2026-09-09', 3224), rcp(2, '2026-09-10', 500)],
  );
  check('two sheet-less days both count', open(i, '2026-09-11').value === 918 + 3224 + 500);
  check('...and are both named', open(i, '2026-09-11').movedOn.join() === '2026-09-09,2026-09-10');
  check('a day before the last sheet is never counted', open(i, '2026-09-09').value === 918);
}
{
  const i = ix({ [`${CRS}_2026-09-08`]: sheet(918, 0, 0) }, {}, [rcp(1, '2026-09-07', 999)]);
  check('a receipt BEFORE the carry sheet is already in its closing', open(i, '2026-09-10').value === 918);
}
{
  // Sales on the carry day reduce what is carried — the ordinary case.
  const i = ix({ [`${CRS}_2026-09-08`]: sheet(1000, 0, 300) }, {}, []);
  check('the carry is the closing, not the opening, of that day', open(i, '2026-09-09').value === 700);
}

console.log('\ninspections move stock without a sheet too');
{
  const i = ix(
    { [`${CRS}_2026-09-08`]: sheet(918, 0, 0) },
    { [`${CRS}_2026-09-09`]: insp(50, 0, 0) },
    [],
  );
  check('an excess on a sheet-less day is carried', open(i, '2026-09-10').value === 968);
}
{
  const i = ix({ [`${CRS}_2026-09-08`]: sheet(918, 0, 0) }, { [`${CRS}_2026-09-09`]: insp(0, 18, 0) }, []);
  check('a shortage subtracts', open(i, '2026-09-10').value === 900);
}
{
  // TRANSFER_IS_OUTWARD: a positive transfer leaves the shop.
  const i = ix({ [`${CRS}_2026-09-08`]: sheet(918, 0, 0) }, { [`${CRS}_2026-09-09`]: insp(0, 0, 18) }, []);
  check('an outward transfer subtracts', open(i, '2026-09-10').value === 900);
}
{
  const i = ix(
    { [`${CRS}_2026-09-08`]: sheet(918, 0, 0) },
    { [`${CRS}_2026-09-09`]: insp(10, 4, 1) },
    [rcp(1, '2026-09-09', 100)],
  );
  check('a receipt and an inspection on the same day both count', open(i, '2026-09-10').value === 918 + 100 + 10 - 4 - 1);
}

console.log('\nacross the month boundary');
{
  const i = ix({ [`${CRS}_2026-09-30`]: sheet(500, 0, 120) }, {}, [rcp(1, '2026-10-01', 800)]);
  check('1 Oct opens at 30 Sept’s closing', open(i, '2026-10-01').value === 380);
  check('2 Oct picks up the 1 Oct delivery', open(i, '2026-10-02').value === 380 + 800);
  check('the carry crosses the year as well', open(ix({ [`${CRS}_2026-12-31`]: sheet(100, 0, 40) }, {}, []), '2027-01-01').value === 60);
}
{
  // A month keyed on Monthly Entry writes its figures out as a projected sheet
  // on the last day. That IS the month's closing, so the next month carries
  // from it like any other sheet.
  const projected = { ...sheet(1000, 500, 1200), __projection: { source: 'monthly', at: 'x' } };
  const i = ix({ [`${CRS}_2026-09-30`]: projected }, {}, []);
  check('a monthly-keyed month carries into the next', open(i, '2026-10-01').value === 300);
}

console.log('\nwhat the chain must not pick up');
{
  const i = ix({ [`${CRS}_2026-09-08`]: sheet(918, 0, 0) }, {}, [rcp(1, '2026-09-09', 3224, 1)]);
  check('another shop’s receipt is not this shop’s stock', open(i, '2026-09-10').value === 918);
}
{
  // CRS 1 and CRS 19 both end in a digit a prefix test would confuse; the id
  // is read as a NUMBER before the first underscore.
  const i = C.buildChainIndex({ '1_2026-09-08': sheet(50, 0, 0), '19_2026-09-08': sheet(918, 0, 0) }, {}, [], 1);
  check('CRS 1 does not pick up CRS 19’s sheet', C.openingFor(i, '2026-09-09', 'BRA', 'a').value === 50);
}
{
  const i = ix({ [`${CRS}_9_2026`]: sheet(1, 2, 3) }, {}, []);
  check('a monthly key is not a day in the chain', open(i, '2026-09-10').value === null);
}
{
  check('with no earlier sheet there is nothing to carry', open(ix({}, {}, [rcp(1, '2026-09-09', 500)]), '2026-09-10').value === null);
}
{
  // A sheet that predates the commodity says nothing about its balance.
  const older = { a: { SUGAR: { open: 5, receipt: 0, total: 5, sales: 0, close: 5 } }, b: {} };
  const i = ix({ [`${CRS}_2026-09-08`]: older }, {}, []);
  check('a sheet with no row for this commodity is not its carry', open(i, '2026-09-10').value === null);
}
{
  const i = ix({ [`${CRS}_2026-09-08`]: sheet(918, 0, 0) }, {}, [{ id: 9, crsId: CRS, date: '2026-09-09', items: { SUGAR: { qty: 40 } } }]);
  check('another commodity’s receipt does not move this one', open(i, '2026-09-10').value === 918);
}
{
  // Section B is the police ration; ids are unique across sections, so a
  // receipt reaches the right row and an inspection is matched by section too.
  const b = { a: {}, b: { PB_BRA: { open: 10, receipt: 0, total: 10, sales: 0, close: 10 } } };
  const i = ix({ [`${CRS}_2026-09-08`]: b }, { [`${CRS}_2026-09-09`]: { a: { PB_BRA: { excess: 99 } }, b: {} } }, []);
  check('an adjustment in the other section does not cross over', C.openingFor(i, '2026-09-10', 'PB_BRA', 'b').value === 10);
}

console.log('\nthe position as at a date (Dashboard Closing Stock)');
{
  const i = ix({ [`${CRS}_2026-09-08`]: sheet(918, 0, 0) }, {}, [rcp(1, '2026-09-09', 3224)]);
  check('as at the 8th it is that sheet’s closing', close(i, '2026-09-08').value === 918);
  check('as at the 9th it includes the delivery', close(i, '2026-09-09').value === 4142);
  check('as at the 10th it still does', close(i, '2026-09-10').value === 4142);
  check('closing as at D equals opening of D+1', close(i, '2026-09-09').value === open(i, '2026-09-10').value);
}

console.log('\nthe days a carry steps over, for the banner');
{
  const i = ix(
    { [`${CRS}_2026-09-08`]: sheet(918, 0, 0) },
    { [`${CRS}_2026-09-11`]: insp(5) },
    [rcp(1, '2026-09-09', 3224)],
  );
  check('both kinds of movement are listed', C.unsheetedMoves(i, '2026-09-08', '2026-09-12').join() === '2026-09-09,2026-09-11');
  check('a day that has a sheet is not listed', C.unsheetedMoves(ix({ [`${CRS}_2026-09-09`]: sheet(1, 1, 0) }, {}, [rcp(1, '2026-09-09', 5)]), '2026-09-08', '2026-09-12').length === 0);
}

console.log(`\n${failures ? `${failures} FAILED` : 'STOCK CHAIN OK'}`);
process.exitCode = failures ? 1 : 0;
