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

console.log('\n9. A shop\'s own commodity at its Order, everywhere (office, 2026-10-07: CRS 10\'s OAP FRK under OAP)');
{
  // As set-commodity-place.mjs --id=OAP_FRK --order=10 --crs=10 leaves the master (written live 2026-10-07).
  const m = base();
  const { moved } = S.placeAtOrder(m, 'OAP_FRK', 10);
  const t = m.find((r) => r.id === 'OAP_FRK');
  t.scope = 'shop'; t.shopId = 10; t.en = 'OAP FRK';
  const l10 = ids(commodityListsFor(m, 10).a);
  check(`CRS 10 Main list: ${l10.slice(7, 12).join(' · ')} — OAP FRK 10th, under OAP`, l10[8] === 'OAP' && l10[9] === 'OAP_FRK' && l10[10] === 'APS' && J(l10.filter((x) => x !== 'OAP_FRK')) === J(A));
  check('every other shop: exactly as before, no OAP FRK', [...Array(30).keys()].map((i) => i + 1).filter((n) => n !== 10 && n !== 29).every((n) => J(ids(commodityListsFor(m, n).a)) === J(A) && J(ids(commodityListsFor(m, n).b)) === J(ids(commodityListsFor(base(), n).b))));
  check(`Order numbers that moved keep their place among the rest (${moved.length}: ${moved.slice(0, 3).join(', ')} …)`, moved.includes('APS') && moved.includes('PB_PALM') && !moved.includes('OAP'));
  // Server-side lists for the statements' roll-up: only for a shop with its own commodity.
  check('ownListsFor: CRS 10 gets its list (= the screens\'), every other shop null (built-in lists, output unchanged)',
    J(ids(S.ownListsFor(m, 10).a)) === J(l10) && [...Array(30).keys()].map((i) => i + 1).filter((n) => n !== 10).every((n) => S.ownListsFor(m, n) === null));

  // The chain: a commodity first on a sheet AFTER the shop's first sheet held none before it — a receipt on a
  // day between (CRS 10: R/2026/087, 2 kg OAP FRK on 25-09; first OAP FRK row 30-09) is carried in, not lost.
  const C = await imp('lib/engine/stockChain.ts');
  const day = (rows) => ({ a: rows, b: {} });
  const es = {
    '10_2026-09-01': day({ OAP: { open: 3, receipt: 0, sales: 0, total: 3, close: 3 } }),
    '10_2026-09-30': day({ OAP: { open: 3, receipt: 0, sales: 3, total: 3, close: 0 }, OAP_FRK: { open: 0, receipt: 0, sales: 0, total: 0, close: 0 } }),
    '10_2026-10-01': day({ OAP: { open: 0, receipt: 0, sales: 0, total: 0, close: 0 }, OAP_FRK: { open: 0, receipt: 0, sales: 0, total: 0, close: 0 } }),
  };
  const rs = [{ crsId: 10, date: '2026-09-25', receiptNo: 'R/2026/087', type: 'advance', items: { OAP_FRK: { qty: 2 } } }];
  const ix = C.buildChainIndex(es, {}, rs, 10);
  check(`chain: OAP FRK 30-09 opens at ${C.openingFor(ix, '2026-09-30', 'OAP_FRK', 'a').value} (0 + the 2 kg of 25-09), closes ${ix.closes['2026-09-30']['a:OAP_FRK']}, 01-10 opens ${C.openingFor(ix, '2026-10-01', 'OAP_FRK', 'a').value}`,
    C.openingFor(ix, '2026-09-30', 'OAP_FRK', 'a').value === 2 && ix.closes['2026-09-30']['a:OAP_FRK'] === 2 && C.openingFor(ix, '2026-10-01', 'OAP_FRK', 'a').value === 2);
  check(`  OAP itself unchanged: 30-09 opens ${C.openingFor(ix, '2026-09-30', 'OAP', 'a').value}, closes ${ix.closes['2026-09-30']['a:OAP']}`, C.openingFor(ix, '2026-09-30', 'OAP', 'a').value === 3 && ix.closes['2026-09-30']['a:OAP'] === 0);
  check('  the shop\'s first sheet is still the start of its chain (nothing to carry into it)', C.openingFor(ix, '2026-09-01', 'OAP_FRK', 'a').value === null && C.openingFor(ix, '2026-09-01', 'OAP', 'a').value === null);
  const fixedEs = JSON.parse(J(es)); fixedEs['10_2026-09-30'].a.OAP_FRK = { open: 50, receipt: 0, sales: 0, total: 50, close: 50, openFixed: true };
  check('  an administrator\'s fixed Opening still wins (50)', C.buildChainIndex(fixedEs, {}, rs, 10).closes['2026-09-30']['a:OAP_FRK'] === 50);
  const { rebuildMonthlyFromDaily: rollup } = await imp('lib/engine/monthlyRollup.ts');
  const repaired = JSON.parse(J(es));
  for (const ds of ['2026-09-30', '2026-10-01']) Object.assign(repaired[`10_${ds}`].a.OAP_FRK, { open: 2, total: 2, close: 2 });
  const sep = rollup(10, 9, 2026, repaired, {}, undefined, S.ownListsFor(m, 10), rs).merged.a.OAP_FRK;
  check(`  September once the sheets carry it: ${sep.open} + ${sep.receipt} = ${sep.total} − ${sep.sales} = ${sep.close} (was −2 + 2 = 0)`, sep.open === 0 && sep.receipt === 2 && sep.total === 2 && sep.close === 2);

  // The Manual 3-Month PV: a commodity only the system's month carries (CRS 10's OAP FRK; the uploaded July / August
  // have no such row) is chained, not dropped, and its bags add up — those months held none.
  const Q = await imp('lib/engine/pvQuarter.ts');
  const fl = (o) => ({ open: 0, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: 0, sales: 0, closing: 0, ...o });
  const qm = (label, rows) => ({ label, source: 'pdf', rows, gunny: null, police: null, notes: [] });
  const quarterRes = Q.chainQuarter(10, [
    qm('July 2026', { BRA: fl({ open: 10, total: 10, closing: 10, bags: { open: 0, receipt: 0, total: 0, sales: 0, closing: 0 } }) }),
    qm('August 2026', { BRA: fl({ open: 10, total: 10, closing: 10, bags: { open: 0, receipt: 0, total: 0, sales: 0, closing: 0 } }) }),
    { ...qm('September 2026', { BRA: fl({ open: 10, total: 10, closing: 10, bags: { open: 0, receipt: 0, total: 0, sales: 0, closing: 0 } }), OAP_FRK: fl({ receipt: 2, total: 2, closing: 2, bags: { open: 0, receipt: 2, total: 2, sales: 2, closing: 0 } }) }), source: 'system' },
  ]);
  const qf = quarterRes.ok ? quarterRes.rows.OAP_FRK : null;
  check(`Manual PV quarter: OAP FRK kgs ${qf?.open} + ${qf?.receipt} − ${qf?.sales} = ${qf?.closing}, bags ${qf?.bags ? `${qf.bags.open} + ${qf.bags.receipt} = ${qf.bags.total} − ${qf.bags.issues} = ${qf.bags.closing}` : 'none'}`,
    !!qf && qf.open === 0 && qf.receipt === 2 && qf.closing === 2 && J(qf.bags) === J({ open: 0, receipt: 2, total: 2, issues: 2, closing: 0 }), quarterRes.ok ? '' : J(quarterRes.problems));

  // The PV: rows in the shop's order, a commodity outside the built-in list under the master's name.
  const { buildPVTable } = await imp('lib/engine/pvStatement.ts');
  const flow = (name) => ({ name, unit: 'KG', open: 0, receipt: 100, total: 100, issues: 12, closing: 88, amount: 0, free: true });
  const commMap = { BRA: flow('BRA Rice'), OAP: flow('OAP Rice'), OAP_FRK: flow('OAP_FRK'), APS: flow('APS Rice'), WHEAT: flow('Wheat') };
  const pvNames = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((y) => y[1].replace(/<[^>]+>/g, '').trim())).filter((c) => c.length > 20 && /^\d+$/.test(c[0]) && c[2] !== 'NOS').map((c) => c[1]);
  const gunny = { ss50: {}, poly: {}, cbox: {} };
  const named = commodityListsFor(m, 10).a.map((c) => ({ ...c, en: c.id === 'OAP_FRK' ? 'OAP FRK' : c.en }));
  const pv10 = pvNames(buildPVTable({ commMap, periodLabel: 'Q', crsId: 10, crsName: '', gunny, staff: {}, commodities: named }));
  check(`PV, CRS 10: ${pv10.join(' · ')}`, J(pv10) === J(['BRA Rice', 'OAP Rice', 'OAP FRK', 'APS Rice', 'Wheat']));
  // No OAP FRK figures in the period (CRS 10 today): its row still prints, at 0, right after OAP — never skipped.
  const noFrk = { BRA: flow('BRA Rice'), OAP: flow('OAP Rice'), APS: flow('APS Rice'), WHEAT: flow('Wheat') };
  const pvZeroHtml = buildPVTable({ commMap: noFrk, periodLabel: 'Q', crsId: 10, crsName: '', gunny, staff: {}, commodities: named });
  const pvZero = pvNames(pvZeroHtml);
  const zeroRow = [...pvZeroHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((y) => y[1].replace(/<[^>]+>/g, '').trim())).find((c) => c[1] === 'OAP FRK') ?? [];
  check(`PV, CRS 10 with no OAP FRK figures: ${pvZero.join(' · ')}; OAP FRK row ${zeroRow.slice(0, 3).join(' ')} … all 0`,
    J(pvZero) === J(['BRA Rice', 'OAP Rice', 'OAP FRK', 'APS Rice', 'Wheat']) && zeroRow[2] === 'KG' && zeroRow.slice(3).filter(Boolean).every((v) => v === '0') && J(noFrk) === J({ BRA: flow('BRA Rice'), OAP: flow('OAP Rice'), APS: flow('APS Rice'), WHEAT: flow('Wheat') }));
  const camp = commodityListsFor(m, 29).a;
  const pv29 = pvNames(buildPVTable({ commMap: { BRA: flow('BRA Rice') }, periodLabel: 'Q', crsId: 29, crsName: '', gunny, staff: {}, commodities: camp }));
  check(`PV, CRS 29: its camp lines are built-in — no zero row added (${pv29.join(' · ')})`, J(pv29) === J(['BRA Rice']) && ids(camp).includes('KERO'));
  const pvOld = pvNames(buildPVTable({ commMap: { BRA: flow('BRA Rice'), OAP: flow('OAP Rice'), APS: flow('APS Rice') }, periodLabel: 'Q', crsId: 1, crsName: '', gunny, staff: {} }));
  check(`PV without a list: the built-in order, as before (${pvOld.join(' · ')})`, J(pvOld) === J(['BRA Rice', 'OAP Rice', 'APS Rice']));
  const pvKept = pvNames(buildPVTable({ commMap, periodLabel: 'Q', crsId: 1, crsName: '', gunny, staff: {}, commodities: commodityListsFor(m, 1).a }));
  check(`PV: a row carrying figures that the shop's list lacks still prints, after them (${pvKept.join(' · ')})`, pvKept.includes('OAP_FRK') && J(pvKept.slice(0, 4)) === J(['BRA Rice', 'OAP Rice', 'APS Rice', 'Wheat']) && pvKept.indexOf('OAP_FRK') === pvKept.length - 1);

  // The statements: CRS 10's own row right after OAP on every form that lists OAP; every other shop unchanged.
  const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);
  const { rebuildMonthlyFromDaily } = await imp('lib/engine/monthlyRollup.ts');
  const sheet = (crs, oapFrk) => ({ a: { BRA: { open: 1000, receipt: 0, sales: 100, total: 1000, close: 900 }, OAP: { open: 3, receipt: 0, sales: 0, total: 3, close: 3 }, APS: { open: 10, receipt: 0, sales: 0, total: 10, close: 10 }, ...(oapFrk ? { OAP_FRK: { open: 0, receipt: 100, sales: 12, total: 100, close: 88 } } : {}) }, b: {} });
  const stores = { entryStore: { '10_2026-09-30': sheet(10, true), '1_2026-09-30': sheet(1, false) }, inspectionStore: {}, monthlyStore: {}, meManualStore: {}, meSourceStore: {}, meRemitStore: {}, meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, receiptStore: [{ id: 1, crsId: 10, date: '2026-09-30', receiptNo: 'T/1', items: { OAP_FRK: { qty: 100 } } }], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {}, meAllotConfirmed: {} };
  const rowsOf = (master, crs, sec) => {
    const st = JSON.parse(J(stores));
    const e = createStatementEngine({
      stores: st, users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Shop ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, commodityMaster: master, CRS_ACCOUNTS: {}, currentUser: null,
      rebuildMonthlyFromDaily: (cid, mo, y) => {
        const key = `${cid}_${mo}_${y}`;
        const next = rebuildMonthlyFromDaily(cid, mo, y, st.entryStore, st.inspectionStore, st.meManualStore[key], S.ownListsFor(master, cid) ?? undefined, st.receiptStore);
        st.monthlyStore[key] = next.merged; st.meSourceStore[key] = next.source;
      },
    });
    const html = e.buildSection(sec, e.getData(crs, 9, 2026));
    return { html, rows: [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => [...x[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((y) => y[1].replace(/<[^>]+>/g, '').trim())) };
  };
  for (const [sec, before, row, after, figs] of [
    ['crs_page2', 'OAP', '12A', 'APS', ['100', '12', '88']],
    ['free_com', 'OAP', '9A', 'APS', ['100', '12', '88']],
    ['sale_tax', 'OAP', '3A', 'APS', ['12']],
    ['b6', 'OAP', '11', 'APS', ['100', '12', '88']],
    ['rbi', 'OAP', '11', null, ['100', '12', '88']],
    ['coll', 'O.A.P', null, 'A.P.S', ['100', '12', '88']],
  ]) {
    const { rows } = rowsOf(m, 10, sec);
    const i = rows.findIndex((c) => c.includes('OAP FRK'));
    const r = rows[i] ?? [];
    check(`${sec}, CRS 10: ${r.filter(Boolean).join(' ')} — after ${rows[i - 1]?.filter(Boolean).slice(0, 2).join(' ')}`,
      i > 0 && rows[i - 1].includes(before) && (row === null || r[0] === row) && (after === null || rows[i + 1].includes(after)) && figs.every((f) => r.includes(f)));
    // OAP FRK is kept in kgs only (office, 2026-10-07): every bag cell of its row blank, the kgs as ever.
    const bagCols = { crs_page2: [2, 4, 9, 11, 15], free_com: [2, 4, 6, 8, 10, 14], b6: [2, 4, 9, 11, 13] }[sec];
    if (bagCols) check(`  ${sec}: OAP FRK's bag cells blank (${bagCols.map((n) => J(r[n])).join(' ')}), kgs 100 / 12 / 88 printed`, bagCols.every((n) => r[n] === '') && ['100', '12', '88'].every((f) => r.includes(f)));
    const plain = rowsOf(base(), 1, sec).html;
    check(`  ${sec}, CRS 1: byte-identical with OAP FRK placed for CRS 10 or not`, rowsOf(m, 1, sec).html === plain && !/OAP FRK<\/td><td>[^<]/.test(plain));
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nALL COMMODITY-SCOPE CHECKS PASSED');
process.exit(failures ? 1 : 0);
