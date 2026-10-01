/**
 * Bag counts typed on Monthly Entry for a row that comes FROM DAILY are saved
 * and stay saved (office, 2026-09-30).
 *
 *   node tools/verify-daily-bags.mjs
 *
 * The recording: CRS 1 September, BRA Rice ("from Daily") — Opening bags
 * 29 → 30 and Sales bags 59 → 60, Save, the tick — and back on Monthly Entry
 * the row read 29 / 59 again. Two faults: the month-close skipped a daily row
 * altogether, so the bag boxes were never sent; and the roll-up re-derived
 * every daily bag count as kgs ÷ pack size on each republish.
 *
 * Through the real functions, synthetic data only:
 *   1. the roll-up lays the typed counts over the daily row — Total =
 *      Opening + Receipt, Closing = Total − Sales — and leaves the kgs alone;
 *   2. only Opening, only Receipt, only Sales, all three; the office's
 *      13 + 20 = 33, 33 − 5 = 28;
 *   3. nothing typed → exactly what the roll-up published before;
 *   4. a later Daily Entry save republishes the month and keeps them, while a
 *      count NOT typed still follows its kgs;
 *   5. Gunny Save's sync keeps them; the Gunny Receipt counts the typed Sales;
 *   6. the activity log records the change;
 *   7. the wiring: Monthly Entry reads and writes them.
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
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { rebuildMonthlyFromDaily, withDailyBags } = await imp('src/lib/engine/monthlyRollup.ts');
const { entryListsFor } = await imp('src/lib/engine/commodities.ts');
const { syncGunnyToSales } = await imp('src/lib/engine/gunnySync.ts');
const { monthSalesBags } = await imp('src/lib/engine/gunnyPack.ts');
const { diffStateWrite } = await imp('src/lib/activityLog/core.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const CRS = 1;
const KEY = `${CRS}_9_2026`;
const lists = entryListsFor(CRS);
const row = (o = {}) => ({ open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, ...o });
const sheet = (a) => ({ a, b: {}, remits: [], remitAmount: 0, remitDate: '' });
// CRS 1 September's BRA Rice as the recording shows it: 1491.220 + 1500 = 2991.220, sold 2991.
const entryStore = {
  [`${CRS}_2026-09-01`]: sheet({ BRA: row({ open: 1491.22, receipt: 1500, total: 2991.22, sales: 1500, close: 1491.22 }) }),
  [`${CRS}_2026-09-28`]: sheet({ BRA: row({ open: 1491.22, total: 1491.22, sales: 1491, close: 0.22 }) }),
};
const bra = (manual, es = entryStore) => {
  const { merged, source } = rebuildMonthlyFromDaily(CRS, 9, 2026, es, {}, manual, lists, []);
  return { r: merged.a.BRA, src: source.a.BRA, merged };
};
const bags = (r) => `${r.g_open} + ${r.g_receipt} = ${r.g_total}, − ${r.g_sales} = ${r.g_close}`;

console.log('1. The recording: BRA Rice from Daily, 29 → 30 and 59 → 60');
const before = bra(undefined);
check(`nothing typed: bags are kgs ÷ 50 — ${bags(before.r)}`, before.src === 'daily' && before.r.g_open === 29 && before.r.g_receipt === 30 && before.r.g_sales === 59);
const typed = { a: {}, b: {}, dailyBags: { a: { BRA: { g_open: 30, g_sales: 60 } } } };
const after = bra(typed);
check(`typed 30 / 60 published: ${bags(after.r)}`, after.r.g_open === 30 && after.r.g_receipt === 30 && after.r.g_total === 60 && after.r.g_sales === 60 && after.r.g_close === 0);
check('the kgs are the day sheets\' and untouched', ['open', 'receipt', 'total', 'sales', 'close', 'amount'].every((f) => after.r[f] === before.r[f]) && after.src === 'daily');

console.log('\n2. One field at a time, and all three');
const cases = [
  ['only Opening 13', { g_open: 13 }, [13, 30, 43, 59, -16]],
  ['only Receipt 20', { g_receipt: 20 }, [29, 20, 49, 59, -10]],
  ['only Sales 5', { g_sales: 5 }, [29, 30, 59, 5, 54]],
  ['Opening 13 + Receipt 20 + Sales 5 (the office\'s example)', { g_open: 13, g_receipt: 20, g_sales: 5 }, [13, 20, 33, 5, 28]],
  ['a typed 0 is a figure', { g_sales: 0 }, [29, 30, 59, 0, 59]],
];
for (const [label, t, want] of cases) {
  const { r } = bra({ a: {}, b: {}, dailyBags: { a: { BRA: t } } });
  const got = [r.g_open, r.g_receipt, r.g_total, r.g_sales, r.g_close];
  check(`${label}: ${bags(r)}`, JSON.stringify(got) === JSON.stringify(want), `want ${want.join(' / ')}`);
}

console.log('\n3. Nothing typed → published exactly as before');
check('no dailyBags: identical to the roll-up alone', JSON.stringify(bra({ a: {}, b: {} }).merged) === JSON.stringify(before.merged));
check('dailyBags for another commodity leave BRA alone', JSON.stringify(bra({ a: {}, b: {}, dailyBags: { a: { WHEAT: { g_open: 3 } } } }).r) === JSON.stringify(before.r));
check('withDailyBags with nothing typed returns the row itself', withDailyBags(before.r, undefined) === before.r && withDailyBags(before.r, {}) === before.r);

console.log('\n4. A later Daily Entry save republishes the month — the typed counts stay');
const more = { ...entryStore, [`${CRS}_2026-09-29`]: sheet({ BRA: row({ open: 0.22, receipt: 500, total: 500.22, sales: 450, close: 50.22 }) }) };
const later = bra(typed, more);
check(`typed Opening 30 / Sales 60 kept after the new sheet: ${bags(later.r)}`, later.r.g_open === 30 && later.r.g_sales === 60);
check(`Receipt, NOT typed, follows the new kgs (2000 kg → ${later.r.g_receipt})`, later.r.g_receipt === 40 && later.r.receipt === 2000);
check('Total and Closing follow the boxes', later.r.g_total === 70 && later.r.g_close === 10);

console.log('\n5. Gunny Save and the Gunny Receipt');
const stores = { entryStore, inspectionStore: {}, receiptStore: [], meManualStore: { [KEY]: typed }, monthlyStore: {}, meSourceStore: {} };
const sync = syncGunnyToSales(stores, CRS, 9, 2026, { EMPTY_BAG: 4 }, lists, '2026-09-30');
const kept = sync.patch.meManualStore?.[KEY];
check('the sync writes Monthly Sales and keeps dailyBags', sync.ok && !!kept && JSON.stringify(kept.dailyBags) === JSON.stringify(typed.dailyBags), JSON.stringify(kept?.dailyBags));
check('the republished month still carries Sales bags 60', sync.patch.monthlyStore?.[KEY]?.a?.BRA?.g_sales === 60);
check(`Gunny Receipt counts the typed Sales: BRA ${monthSalesBags(after.merged).BRA} (was ${monthSalesBags(before.merged).BRA})`, monthSalesBags(after.merged).BRA === 60 && monthSalesBags(before.merged).BRA === 59);

console.log('\n6. The activity log records it');
const drafts = diffStateWrite({ meManualStore: { [KEY]: { a: {}, b: {} } } }, { meManualStore: { [KEY]: typed } }, { meManualStore: { [KEY]: 'closed' } });
const lines = drafts.flatMap((d) => d.changes ?? []).map((c) => `${c.label}: ${c.before} → ${c.after}`);
check(`a Monthly Entry row names both counts (${lines.join('; ')})`, lines.some((l) => /Gunny Opening \(bags\): carried \/ from kgs → 30/.test(l)) && lines.some((l) => /Gunny Sales \(bags\): from kgs → 60/.test(l)));
check('a save that changes nothing logs nothing', diffStateWrite({ meManualStore: { [KEY]: typed } }, { meManualStore: { [KEY]: structuredClone(typed) } }).length === 0);

console.log('\n7. Wiring');
const page = readFileSync(join(root, 'src/app/(app)/monthly-entry/page.tsx'), 'utf8');
check('the month-close no longer drops a daily row\'s bag boxes', /if \(r\.derived\) \{[\s\S]{0,1400}dailyBags\[sec\][\s\S]{0,80}continue;/.test(page) && /manual\.dailyBags = dailyBags/.test(page));
check('only a count that differs from its default is stored (Opening: last month\'s Closing bags; Receipt / Sales: kgs ÷ pack)', /r\.g\.open !== r\.gOpenDefault/.test(page) && /r\.g\[f\] !== bagsOf\(kg, r\.c\.id\)/.test(page));
const chainSrc = readFileSync(join(root, 'src/lib/engine/bagChain.ts'), 'utf8');
check('the grid shows a saved daily count (bagRowFor reads dailyBags)', /bagRowFor\(sec, c\.id, rec, src, meManualStore\[key\]/.test(page) && /typed = derived \? manual\?\.dailyBags/.test(chainSrc));
const sync2 = readFileSync(join(root, 'src/lib/engine/gunnySync.ts'), 'utf8');
check('Gunny Save\'s sync spreads the month record before rewriting a / b', /meManualStore\[key\] = \{ \.\.\.meManualStore\[key\], a:/.test(sync2));

console.log(failures ? `\n${failures} FAILED` : '\nALL DAILY-BAG CHECKS PASSED');
process.exit(failures ? 1 : 0);
