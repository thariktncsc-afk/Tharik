/**
 * Commodity scope — All Shops or one Particular Shop (office, 2026-10-01;
 * src/lib/engine/commodityScope.ts, src/lib/masters.ts).
 *
 *   node tools/verify-commodity-scope.mjs
 *
 * Through the real functions, synthetic data shaped like the live master:
 *   1. existing rows carry no scope → every shop's lists exactly as before;
 *   2. "Special Rice", CRS 14 only, Order 23 → on CRS 14's list at Order 23,
 *      on no other shop's; an all-shops view (no shop) sees it;
 *   3. Order: a free number moves nothing, a taken one moves only the run of
 *      rows up to the first free number; changing the Order moves it on the
 *      list; the camp (CRS 29) takes its own at their Order too;
 *   4. All Shops ↔ Particular Shop;
 *   5. the server: a shop user is sent only global + own rows; figures keyed
 *      into another shop's commodity are refused (day sheet, month, receipt)
 *      while its own shop, and old figures re-carried, pass;
 *   6. wiring: /api/state filters the read, keeps the master admin-only and
 *      runs the guard; the Commodity Master form has Order / Scope / Shop.
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
  if (s === 'next/headers' || s === 'next/server') s += '.js';
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
const { commodityListsFor } = await imp('lib/masters.ts');
const S = await imp('lib/engine/commodityScope.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const J = JSON.stringify;
const ids = (l) => l.map((c) => c.id);

// The live master's shape (2026-10-01): one numbering, Main 1–22, Police 23–27, OAP_FRK 28.
const A = ['BRA', 'NPHH_FRK', 'PHH_FRK', 'PHH_BRA', 'AAY_FRK', 'AAY', 'RRA', 'NPHH_RRA', 'OAP', 'APS', 'WHEAT', 'SUGAR', 'AAY_SUGAR', 'TOOR', 'PALM', 'SALT_CIS', 'SALT_RFFS', 'OOTY', 'TAN', 'EMPTY_BOX', 'EMPTY_BAG'];
const row = (id, order, section = 'a', extra = {}) => ({ id, en: id, ta: id, unit: 'KG', rate: 0, free: true, section, order, active: true, ...extra });
const base = () => [
  ...A.map((id, i) => row(id, i + 1)),
  row('KERO', 22, 'a', { crs29Only: true }),
  ...['PB_BRA', 'PB_SUGAR', 'PB_WHEAT', 'PB_TOOR', 'PB_PALM'].map((id, i) => row(id, 23 + i, 'b')),
  row('OAP_FRK', 28),
];

console.log('1. Existing commodities carry no scope — every shop as before');
{
  const m = base();
  const before = ids(commodityListsFor(m, 1).a);
  check(`CRS 1 Main list unchanged (${before.length} rows, OAP_FRK last)`, J(before) === J([...A, 'OAP_FRK']));
  check('every shop 1–28 and 30 gets the same lists', [...Array(30).keys()].map((i) => i + 1).filter((n) => n !== 29).every((n) => J(commodityListsFor(m, n)) === J(commodityListsFor(m, 1))));
  check('CRS 29 keeps its own fixed list', commodityListsFor(m, 29).b.length === 0 && ids(commodityListsFor(m, 29).a).includes('KERO'));
}

console.log('\n2. "Special Rice", Particular Shop CRS 14, Order 23');
const withSpecial = () => {
  const m = base();
  m.push(row('SPECIAL', 23, 'a', { en: 'Special Rice', scope: 'shop', shopId: 14 }));
  const { moved } = S.placeAtOrder(m, 'SPECIAL', 23);
  return { m, moved };
};
{
  const { m, moved } = withSpecial();
  const l14 = ids(commodityListsFor(m, 14).a);
  check(`on CRS 14's list after Empty Polythene Bag (Order 21) and before OAP_FRK: …${l14.slice(-3).join(', ')}`, J(l14.slice(-3)) === J(['EMPTY_BAG', 'SPECIAL', 'OAP_FRK']));
  check(`Special Rice keeps Order 23: ${m.find((c) => c.id === 'SPECIAL').order}`, m.find((c) => c.id === 'SPECIAL').order === 23);
  for (const n of [1, 5, 10, 13, 15, 30]) check(`CRS ${n}: not on its list`, !ids(commodityListsFor(m, n).a).includes('SPECIAL'));
  check('CRS 29 (camp): not on its list', !ids(commodityListsFor(m, 29).a).includes('SPECIAL'));
  check('an all-shops view (no shop chosen) sees it', ids(commodityListsFor(m, null).a).includes('SPECIAL'));
  check(`only the run 23–28 moved to make room (${moved.join(', ')}); Main 1–21 untouched`, J(moved) === J(['PB_BRA', 'PB_SUGAR', 'PB_WHEAT', 'PB_TOOR', 'PB_PALM', 'OAP_FRK']) && A.every((id, i) => m.find((c) => c.id === id).order === i + 1));
  check('every other shop\'s lists are exactly as before', J(commodityListsFor(m, 1)) === J(commodityListsFor(base(), 1)));
}

console.log('\n3. Order — exact position, minimal movement, and a change of Order');
{
  const m = base();
  m.push(row('FREEPOS', 40, 'a', { scope: 'shop', shopId: 14 }));
  const { moved } = S.placeAtOrder(m, 'FREEPOS', 40);
  check(`a free Order (40) moves nothing (${moved.length})`, moved.length === 0 && ids(commodityListsFor(m, 14).a).at(-1) === 'FREEPOS');
  const { m: m2 } = withSpecial();
  S.placeAtOrder(m2, 'SPECIAL', 5);
  const l = ids(commodityListsFor(m2, 14).a);
  check(`Order 23 → 5: CRS 14 now lists it 5th (${l.slice(0, 6).join(', ')})`, l[4] === 'SPECIAL' && l[3] === 'PHH_BRA' && l[5] === 'AAY_FRK');
  check('the other shops keep their order of commodities', J(ids(commodityListsFor(m2, 1).a)) === J([...A, 'OAP_FRK']));
  const m3 = base();
  m3.push(row('CAMPX', 3, 'a', { scope: 'shop', shopId: 29 }));
  const l29 = ids(commodityListsFor(m3, 29).a);
  const camp = ids(commodityListsFor(base(), 29).a);
  check(`CRS 29's own commodity at Order 3 sits before the camp line with a higher Order: ${l29.join(', ')}`, l29.length === camp.length + 1 && l29.indexOf('CAMPX') === camp.findIndex((id) => m3.find((c) => c.id === id).order > 3));
}

console.log('\n4. All Shops ↔ Particular Shop');
{
  const { m } = withSpecial();
  const sp = m.find((c) => c.id === 'SPECIAL');
  delete sp.scope; delete sp.shopId;
  check('Particular → All Shops: on every shop\'s list', [1, 5, 14, 30].every((n) => ids(commodityListsFor(m, n).a).includes('SPECIAL')));
  sp.scope = 'shop'; sp.shopId = 5;
  check('All Shops → CRS 5: on CRS 5 only', ids(commodityListsFor(m, 5).a).includes('SPECIAL') && !ids(commodityListsFor(m, 14).a).includes('SPECIAL'));
  check('a scope with no valid shop is All Shops, never "nobody"', S.scopeShop({ id: 'X', order: 1, scope: 'shop', shopId: '' }) === null);
}

console.log('\n5. The server');
{
  const { m } = withSpecial();
  check('CRS 14 user is sent Special Rice', S.masterForShop(m, 14).some((c) => c.id === 'SPECIAL'));
  check('CRS 1 user is not', !S.masterForShop(m, 1).some((c) => c.id === 'SPECIAL') && S.masterForShop(m, 1).length === m.length - 1);
  check('a shop user with no shop gets the global rows only', !S.masterForShop(m, null).some((c) => c.id === 'SPECIAL'));
  const sheet = (sales) => ({ a: { BRA: { open: 10, sales: 1, close: 9 }, SPECIAL: { open: 0, receipt: 0, sales, close: -sales } }, b: {} });
  const v1 = S.inspectScopeWrite({ entryStore: {} }, { entryStore: { '1_2026-10-02': sheet(5) } }, m);
  check(`CRS 1 day sheet keying Special Rice: refused — ${S.describeScope(v1)}`, v1.length === 1 && v1[0].crsId === 1 && v1[0].owner === 14);
  check('CRS 14 keying it: passes', S.inspectScopeWrite({ entryStore: {} }, { entryStore: { '14_2026-10-02': sheet(5) } }, m).length === 0);
  check('a CRS 1 sheet that does not touch it: passes', S.inspectScopeWrite({ entryStore: {} }, { entryStore: { '1_2026-10-02': { a: { BRA: { sales: 3 } }, b: {} } } }, m).length === 0);
  const old = { entryStore: { '1_2026-09-30': sheet(5) } };
  const recarried = { entryStore: { '1_2026-09-30': { ...sheet(5), a: { ...sheet(5).a, SPECIAL: { open: 7, receipt: 0, sales: 5, close: 2 } } } } };
  check('figures saved before the re-scope, re-carried (Opening only moves): pass', S.inspectScopeWrite(old, recarried, m).length === 0);
  check('CRS 1 hand-keyed month with Special Rice Sales: refused', S.inspectScopeWrite({}, { meManualStore: { '1_10_2026': { a: { SPECIAL: { open: 0, receipt: 0, sales: 4 } }, b: {} } } }, m).length === 1);
  check('a CRS 1 receipt line of Special Rice: refused', S.inspectScopeWrite({ receiptStore: [] }, { receiptStore: [{ id: 9, crsId: 1, receiptNo: 'R1', items: { SPECIAL: { qty: 50 } } }] }, m).length === 1);
  check('a CRS 14 receipt line of it: passes', S.inspectScopeWrite({ receiptStore: [] }, { receiptStore: [{ id: 9, crsId: 14, receiptNo: 'R1', items: { SPECIAL: { qty: 50 } } }] }, m).length === 0);
  check('no scoped commodity at all → nothing to check', S.inspectScopeWrite({}, { entryStore: { '1_2026-10-02': sheet(5) } }, base()).length === 0);
}

console.log('\n6. Wiring');
{
  const route = readFileSync(join(root, 'src/app/api/state/route.ts'), 'utf8');
  check('GET: shop staff get masterForShop(…) of the master', /session\.role !== 'ADMIN'[\s\S]{0,120}masterForShop\(/.test(route));
  check('POST: only an administrator writes __commodityMaster', /!isAdmin && '__commodityMaster' in stores/.test(route));
  check('POST: the scope guard runs, reading the master with the protected stores', /inspectScopeWrite\(stored, stores, master\)/.test(route) && /\['__commodityMaster'\]/.test(route));
  const page = readFileSync(join(root, 'src/app/(app)/commodities/page.tsx'), 'utf8');
  check('the form has Order, Scope (All Shops / Particular Shop) and the shop', /aria-label="Order"/.test(page) && /All Shops/.test(page) && /Particular Shop/.test(page) && /Select CRS Shop/.test(page));
  check('the form refuses Particular Shop without a shop', /Choose the CRS shop this commodity is for/.test(page));
  check('Order is placed with placeAtOrder, not appended', /placeAtOrder\(list, id, order\)/.test(page) && !/Math\.max\(0, \.\.\.list\.map/.test(page));
}

console.log(failures ? `\n${failures} FAILED` : '\nALL COMMODITY-SCOPE CHECKS PASSED');
process.exit(failures ? 1 : 0);
