/**
 * Previous month's Closing → this month's Opening on Monthly Entry, for every
 * user (office, 2026-10-01).
 *
 *   node tools/verify-carry-forward.mjs
 *
 * The fault: an administrator's Opening box showed only a typed or saved
 * figure, so a month nobody had saved yet (October 2026, every shop) opened
 * at 0.000 — and a month-close would have saved the zeros. The carry was
 * worked out only for a shop user's locked Opening.
 *
 *   1. the stock chain carries September's Closing into 01-10 for a shop
 *      keyed by day, decimals included, Police too;
 *   2. a month keyed by month and not yet closed has no sheet for the chain —
 *      last month's published Closing is the carry (rebuildMonthlyFromDaily);
 *   3. wiring: rowFor carries for everyone where the month holds no saved row
 *      (a saved or typed Opening still wins; sales-only bag rows excluded) and
 *      the box shows that figure; refresh-gunny compares figures, not
 *      timestamps, so the September Gunny catch-up re-runs as a no-op.
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
const { buildChainIndex, openingFor } = await imp('src/lib/engine/stockChain.ts');
const { rebuildMonthlyFromDaily } = await imp('src/lib/engine/monthlyRollup.ts');
const { entryListsFor } = await imp('src/lib/engine/commodities.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const row = (o) => ({ open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, ...o });
const sheet = (a, b = {}) => ({ a, b, remits: [], remitAmount: 0, remitDate: '' });

console.log('1. Keyed by day: the chain carries September\'s Closing into 01-10');
{
  const es = {
    '5_2026-09-01': sheet({ BRA: row({ open: 2000, total: 2000, sales: 100, close: 1900 }), SUGAR: row({ open: 700.624, total: 700.624, sales: 20, close: 680.624 }) }, { PB_BRA: row({ open: 12, total: 12, close: 12 }) }),
    '5_2026-09-29': sheet({ BRA: row({ open: 1900, total: 1900, sales: 1727, close: 173 }), SUGAR: row({ open: 680.624, total: 680.624, close: 680.624 }) }, { PB_BRA: row({ open: 12, receipt: 18, total: 30, sales: 18, close: 12 }) }),
  };
  const ch = buildChainIndex(es, {}, [], 5);
  const bra = openingFor(ch, '2026-10-01', 'BRA', 'a').value, sug = openingFor(ch, '2026-10-01', 'SUGAR', 'a').value, pol = openingFor(ch, '2026-10-01', 'PB_BRA', 'b').value;
  check(`BRA 173, SUGAR 680.624 (decimals kept), Police BRA 12 → ${bra}, ${sug}, ${pol}`, bra === 173 && sug === 680.624 && pol === 12);
}

console.log('\n2. Keyed by month, not yet closed: last month\'s published Closing');
{
  const manual = { a: { BRA: row({ open: 0, receipt: 1000, total: 1000, close: 1000 }) }, b: {} };
  const ch = buildChainIndex({}, {}, [], 23);
  const viaChain = openingFor(ch, '2026-10-01', 'BRA', 'a').value;
  const prev = rebuildMonthlyFromDaily(23, 9, 2026, {}, {}, manual, entryListsFor(23), []).merged;
  check(`no sheet → the chain has nothing (${viaChain}); September publishes BRA Closing ${prev.a.BRA.close} — the carry`, viaChain === null && prev.a.BRA.close === 1000);
}

console.log('\n3. Wiring');
const page = readFileSync(join(root, 'src/app/(app)/monthly-entry/page.tsx'), 'utf8');
check('last month is rebuilt for the carry (prevMerged)', /const prevMerged = useMemo\(/.test(page) && /rebuildMonthlyFromDaily\(crsId, pm, py,/.test(page));
check('rowFor carries for everyone where the month has no saved row; a typed/saved Opening wins', /e\.open !== undefined \|\| savedRow\s*\?\s*num\(e\.open, rec\?\.open\)\s*:\s*\(carryIn\(\) \?\? /.test(page));
check('…chain first, else last month\'s Closing; never for the sales-only bag rows', /if \(SALES_ONLY\.has\(c\.id\) \|\| !crsId\) return null;/.test(page) && /if \(viaChain !== null\) return viaChain;/.test(page) && /prev\.close/.test(page));
check('the Opening box shows the row\'s Opening (the carry), not only a stored figure', /const shownStored = field === 'open' \? r\.open : stored;/.test(page));
const rg = readFileSync(join(root, 'tools/refresh-gunny.mjs'), 'utf8');
check('refresh-gunny compares figures, not updatedAt', /const figures = \(v\) => canon\(v\)\.replace\(\/"updatedAt"/.test(rg));

console.log(failures ? `\n${failures} FAILED` : '\nALL CARRY-FORWARD CHECKS PASSED');
process.exit(failures ? 1 : 0);
