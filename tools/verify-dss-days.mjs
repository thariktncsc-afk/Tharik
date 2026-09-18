/**
 * Which dates get a DSS page (src/lib/engine/dssDays.ts), as executable cases.
 *
 *   node tools/verify-dss-days.mjs
 *
 * One page per shop per date: Sales only, Receipt only, or both — never two.
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
const D = await import(pathToFileURL(join(root, 'src/lib/engine/dssDays.ts')).href);
const R = await import(pathToFileURL(join(root, 'src/lib/engine/rechain.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const show = (v) => JSON.stringify(v);
const row = (open, receipt, sales) => ({ open, receipt, total: open + receipt, sales, close: open + receipt - sales, amount: 0 });
const rcp = (id, date, qty, crsId = 8) => ({ id, crsId, date, receiptNo: `R/${id}`, items: { BRA: { qty } } });
const pages = (store, crs = 8) => Object.keys(store).filter((k) => k.startsWith(`${crs}_2026-09-`)).sort();

// 14 Sep closes at 1,000 KG; 15 Sep has only a 500 KG receipt.
const base = { '8_2026-09-14': { a: { BRA: row(1200, 0, 200) }, b: {} } };

console.log('\nReceipt only, no sales — the office example');
{
  const aug = D.withReceiptOnlyDays(base, {}, [rcp(1, '2026-09-15', 500)], 8, 9, 2026);
  const p = aug['8_2026-09-15'];
  check('15 Sep gets a DSS page', !!p, show(pages(aug)));
  check('OB 1,000 + Receipt 500 = Total 1,500 → Sales 0 → CB 1,500', p?.a.BRA.open === 1000 && p.a.BRA.receipt === 500 && p.a.BRA.total === 1500 && p.a.BRA.sales === 0 && p.a.BRA.close === 1500, show(p?.a.BRA));
  check('it is marked as generated, not a saved sheet', p?.[D.RECEIPT_ONLY] === true);
  check('the stores passed in are untouched', !base['8_2026-09-15']);
  check('DSS days: 2 (14 and 15 Sep)', D.dssDayCount(base, {}, [rcp(1, '2026-09-15', 500)], 8, 9, 2026) === 2);
}

console.log('\nThen Sales of 200 KG on the same date — still ONE page');
{
  // Saving 15 Sep on Daily Entry: the sheet carries the register receipt.
  const saved = { ...base, '8_2026-09-15': { a: { BRA: row(1000, 500, 200) }, b: {} } };
  const aug = D.withReceiptOnlyDays(saved, {}, [rcp(1, '2026-09-15', 500)], 8, 9, 2026);
  check('one page for 15 Sep (the saved sheet), not two', pages(aug).filter((k) => k.endsWith('-15')).length === 1 && aug['8_2026-09-15'] === saved['8_2026-09-15']);
  check('OB 1,000 + Receipt 500 = 1,500 → Sales 200 → CB 1,300', aug['8_2026-09-15'].a.BRA.close === 1300);
  check('DSS days still 2', D.dssDayCount(saved, {}, [rcp(1, '2026-09-15', 500)], 8, 9, 2026) === 2);
}

console.log('\nSales only — unchanged');
{
  const aug = D.withReceiptOnlyDays(base, {}, [], 8, 9, 2026);
  check('only the day sheets, exactly as stored', show(aug) === show(base));
}

console.log('\nLive: the page follows the receipt');
{
  const edited = D.withReceiptOnlyDays(base, {}, [rcp(1, '2026-09-15', 650)], 8, 9, 2026);
  check('receipt edited to 650 → page 1,000 + 650 = 1,650', edited['8_2026-09-15'].a.BRA.close === 1650);
  const gone = D.withReceiptOnlyDays(base, {}, [], 8, 9, 2026);
  check('receipt deleted → no page for 15 Sep', !gone['8_2026-09-15']);
  const two = D.withReceiptOnlyDays(base, {}, [rcp(1, '2026-09-15', 500), rcp(2, '2026-09-16', 100)], 8, 9, 2026);
  check('two receipt-only days in a row carry into each other (16 Sep opens at 1,500)', two['8_2026-09-16'].a.BRA.open === 1500 && two['8_2026-09-16'].a.BRA.close === 1600, show(two['8_2026-09-16']?.a.BRA));
}

console.log('\nThe next saved day carries the receipt-only day\'s Closing');
{
  const receipts = [rcp(1, '2026-09-15', 500)];
  const later = { ...base, '8_2026-09-17': { a: { BRA: row(0, 0, 100) }, b: {} } };
  const rebuilt = R.rebuildChain({ entryStore: later, inspectionStore: {}, receiptStore: receipts }, 8, '2026-09-15').entryStore;
  const aug = D.withReceiptOnlyDays(rebuilt, {}, receipts, 8, 9, 2026);
  check('15 Sep page CB 1,500 = 17 Sep OB 1,500', aug['8_2026-09-15'].a.BRA.close === 1500 && rebuilt['8_2026-09-17'].a.BRA.open === 1500, show(rebuilt['8_2026-09-17'].a.BRA));
}

console.log('\nLeft out on purpose');
{
  const proj = { ...base, '8_2026-09-30': { a: { BRA: row(1000, 500, 0) }, b: {}, __projection: { source: 'monthly' } } };
  check('a month keyed on Monthly Entry gets no extra receipt pages', !D.withReceiptOnlyDays(proj, {}, [rcp(1, '2026-09-15', 500)], 8, 9, 2026)['8_2026-09-15']);
  check('a receipt before the shop\'s first sheet gets no page (no Opening to carry)', !D.withReceiptOnlyDays(base, {}, [rcp(1, '2026-09-10', 500)], 8, 9, 2026)['8_2026-09-10']);
  check('another shop\'s receipt adds nothing here', !D.withReceiptOnlyDays(base, {}, [rcp(1, '2026-09-15', 500, 9)], 8, 9, 2026)['8_2026-09-15']);
  check('CRS 1 never picks up CRS 10\'s dates', pages(D.withReceiptOnlyDays({ '10_2026-09-14': base['8_2026-09-14'] }, {}, [rcp(1, '2026-09-15', 5, 10)], 1, 9, 2026), 1).length === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nDSS DAYS OK');
process.exitCode = failures ? 1 : 0;
