/**
 * A commodity's BAG counts carry from month to month (office, 2026-10-01;
 * src/lib/engine/bagChain.ts).
 *
 *   node tools/verify-bag-carry.mjs
 *
 *   Opening bags + Receipt bags = Total bags
 *   Total bags − Sales bags = Closing bags
 *   last month's Closing bags = this month's Opening bags — never kgs ÷ 50
 *
 * The office's case: CRS 23 September, BRA Rice Opening bags typed 47 (the
 * kgs, 2316.998, give 46); with 46 bags sold September closes at 1 and
 * October must open at 1 — it opened at 46.
 *
 *   1. the CRS 23 case, with and without the 46 sold;
 *   2. the arithmetic: Opening / Receipt / Sales +1 move Total and Closing;
 *   3. an Opening typed for the month wins — a from-Daily dailyBags.g_open, a
 *      hand-keyed row saved with g_openFixed; a hand-keyed row saved WITHOUT
 *      the mark follows the carry (its stored copy is not read);
 *   4. a month holding nothing passes the carry straight through (Sep → Nov);
 *   5. the shop's first month keeps its typed / imported / kgs ÷ pack figure;
 *      C.Box / Poly and the no-bag police rows carry nothing;
 *   6. the statements (generated engine, ctx.bagOpening as the server hands
 *      it): CRS Page 2 prints October's Opening 1, Total, Closing; without
 *      the lookup the old rule (kgs ÷ 50 = 46) — what the goldens hold;
 *   7. wiring: Monthly Sales, its save, the server, 45-bag-counts.js.
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
const B = await imp('lib/engine/bagChain.ts');
const { entryListsFor } = await imp('lib/engine/commodities.ts');
const { rebuildMonthlyFromDaily } = await imp('lib/engine/monthlyRollup.ts');
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const J = JSON.stringify;
const CRS = 23;
const lists = entryListsFor(CRS);
const row = (o) => ({ open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, ...o });
// CRS 23 as saved on 2026-10-01: the 01-09 Initial Opening, BRA bags typed 47.
const base = () => ({
  entryStore: {
    '23_2026-09-01': {
      a: { BRA: row({ open: 2316.998, total: 2316.998, close: 2316.998, openFixed: true }), PHH_BRA: row({ open: 417, total: 417, close: 417, openFixed: true }), EMPTY_BOX: row({ sales: 62, total: 0, close: -62 }) },
      b: { PB_BRA: row({ open: 2, total: 2, close: 2, openFixed: true }), PB_SUGAR: row({ open: 60, total: 60, close: 60, openFixed: true }) },
    },
  },
  inspectionStore: {},
  meManualStore: { '23_9_2026': { a: {}, b: {}, dailyBags: { a: { BRA: { g_open: 47 } } } } },
  receiptStore: [],
});
const carried = (st, m, y = 2026) => B.carriedBagsFor(st, CRS, m, y, lists);
const bags = (st, m, y = 2026) => B.monthBags(st, CRS, m, y, lists, carried(st, m, y));
const tuple = (r) => [r.open, r.receipt, r.total, r.sales, r.close];

console.log('1. CRS 23: September Total 47 − Sales 46 = Closing 1 → October opens at 1');
{
  const st = base();
  const sep = bags(st, 9);
  check(`September as saved: BRA ${J(tuple(sep.a.BRA))} (Opening typed 47, nothing sold)`, J(tuple(sep.a.BRA)) === J([47, 0, 47, 0, 47]));
  check(`October opens at September's Closing 47 — not 46 (kgs ÷ 50): ${bags(st, 10).a.BRA.open}`, bags(st, 10).a.BRA.open === 47);
  st.meManualStore['23_9_2026'].dailyBags.a.BRA.g_sales = 46;
  const s2 = bags(st, 9);
  check(`with 46 bags sold in September: ${s2.a.BRA.open} + ${s2.a.BRA.receipt} = ${s2.a.BRA.total}, − ${s2.a.BRA.sales} = ${s2.a.BRA.close}`, J(tuple(s2.a.BRA)) === J([47, 0, 47, 46, 1]));
  check(`October Opening bags = 1 (${bags(st, 10).a.BRA.open}); PHH BRA 8 → 8 (${bags(st, 10).a.PHH_BRA.open})`, bags(st, 10).a.BRA.open === 1 && bags(st, 10).a.PHH_BRA.open === 8);
}

console.log('\n2. The arithmetic — every +1 moves Total and Closing at once');
{
  const k = { open: 0, receipt: 0, sales: 0 };
  const r0 = B.bagRowFor('a', 'BRA', row({}), 'manual', undefined, k, 1);
  check(`carried 1, nothing else: ${J(tuple(r0))}`, J(tuple(r0)) === J([1, 0, 1, 0, 1]));
  const r1 = B.bagRowFor('a', 'BRA', row({ receipt: 50 }), 'daily', undefined, { ...k, receipt: 50 }, 1);
  check(`Receipt +1 bag (50 kg): Total ${r1.total}, Closing ${r1.close}`, r1.total === 2 && r1.close === 2);
  const r2 = B.bagRowFor('a', 'BRA', row({ receipt: 50, sales: 50 }), 'daily', undefined, { ...k, receipt: 50, sales: 50 }, 1);
  check(`Sales +1 bag: Closing ${r2.close} (−1)`, r2.close === 1);
  const r3 = B.bagRowFor('a', 'BRA', row({}), 'daily', { a: {}, b: {}, dailyBags: { a: { BRA: { g_open: 2 } } } }, k, 1);
  check(`Opening typed +1 (2 over the carried 1): Total ${r3.total}, Closing ${r3.close}`, r3.open === 2 && r3.total === 2 && r3.close === 2 && r3.openTyped);
  const r4 = B.bagRowFor('a', 'BRA', row({ g_cs: 1 }), 'manual', undefined, k, 3);
  check(`C.S bags come off the Closing too: 3 − 1 = ${r4.close}`, r4.close === 2);
}

console.log('\n3. An Opening typed for the month wins; a saved copy of the carry follows it');
{
  const st = base();
  st.meManualStore['23_9_2026'].dailyBags.a.BRA.g_sales = 46; // September closes at 1
  // October keyed by month, saved before this change: g_open stored as kgs ÷ 50, no mark.
  st.meManualStore['23_10_2026'] = { a: { BRA: row({ open: 2316.998, total: 2316.998, close: 2316.998, g_open: 46, g_total: 46, g_close: 46 }) }, b: {} };
  check(`hand-keyed October, stored 46 with no mark → the carry: ${bags(st, 10).a.BRA.open}`, bags(st, 10).a.BRA.open === 1);
  st.meManualStore['23_10_2026'].a.BRA.g_open = 5;
  st.meManualStore['23_10_2026'].a.BRA.g_openFixed = true;
  check(`hand-keyed October, an administrator's 5 (g_openFixed) → 5: ${bags(st, 10).a.BRA.open}`, bags(st, 10).a.BRA.open === 5 && bags(st, 10).a.BRA.openTyped);
  const st2 = base();
  st2.entryStore['23_2026-10-01'] = { a: { BRA: row({ open: 2316.998, total: 2316.998, close: 2316.998 }) }, b: {} };
  st2.meManualStore['23_10_2026'] = { a: {}, b: {}, dailyBags: { a: { BRA: { g_open: 9 } } } };
  check(`October by day, dailyBags.g_open 9 → 9 (default ${bags(st2, 10).a.BRA.openDefault} = September's Closing)`, bags(st2, 10).a.BRA.open === 9 && bags(st2, 10).a.BRA.openDefault === 47);
  delete st2.meManualStore['23_10_2026'];
  check(`October by day, nothing typed → the carry 47: ${bags(st2, 10).a.BRA.open}`, bags(st2, 10).a.BRA.open === 47);
  // September changes after October was saved: October follows (nothing stored to go stale).
  st2.meManualStore['23_9_2026'].dailyBags.a.BRA.g_open = 50;
  check(`September Opening changed 47 → 50: October follows to ${bags(st2, 10).a.BRA.open}`, bags(st2, 10).a.BRA.open === 50);
}

console.log('\n4. A month holding nothing passes the carry through');
{
  const st = base();
  st.meManualStore['23_9_2026'].dailyBags.a.BRA.g_sales = 46;
  st.entryStore['23_2026-11-02'] = { a: { BRA: row({ open: 2316.998, total: 2316.998, close: 2316.998 }) }, b: {} };
  check(`October empty → November opens at September's 1: ${bags(st, 11).a.BRA.open}; next year too (Jan 2027: ${bags(st, 1, 2027).a.BRA.open})`, bags(st, 11).a.BRA.open === 1 && bags(st, 1, 2027).a.BRA.open === 1);
}

console.log('\n5. The first month, and rows that carry nothing');
{
  const st = base();
  check('September is the shop\'s first month: nothing to carry (null)', carried(st, 9) === null);
  const sep = bags(st, 9);
  check(`its Openings are the typed 47 and kgs ÷ 50 for the rest (PHH BRA ${sep.a.PHH_BRA.open})`, sep.a.BRA.open === 47 && sep.a.PHH_BRA.open === 8);
  const look = B.bagOpeningLookup(st);
  check(`the statement lookup: September → null (builders' own rule); October BRA → ${look('23_10_2026', 'a', 'BRA')}`, look('23_9_2026', 'a', 'BRA') === null && look('23_10_2026', 'a', 'BRA') === 47);
  check(`C.Box (sales only) and police Sugar (no bag box) → null: ${look('23_10_2026', 'a', 'EMPTY_BOX')} / ${look('23_10_2026', 'b', 'PB_SUGAR')}; police BRA carries ${look('23_10_2026', 'b', 'PB_BRA')}`, look('23_10_2026', 'a', 'EMPTY_BOX') === null && look('23_10_2026', 'b', 'PB_SUGAR') === null && look('23_10_2026', 'b', 'PB_BRA') === 0);
}

console.log('\n6. The statements: CRS Page 2 prints the carried bags');
{
  const st = base();
  st.meManualStore['23_9_2026'].dailyBags.a.BRA.g_sales = 46;
  // October keyed by day: its first sheet opens at the carried kgs.
  st.entryStore['23_2026-10-01'] = { a: { BRA: row({ open: 2316.998, total: 2316.998, close: 2316.998 }) }, b: {} };
  const render = (m, withLookup) => {
    const stores = {
      ...JSON.parse(J(st)), monthlyStore: {}, meSourceStore: {}, meRemitStore: {}, meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    };
    const e = createStatementEngine({
      stores, users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
      ...(withLookup ? { bagOpening: B.bagOpeningLookup(stores) } : {}),
      rebuildMonthlyFromDaily: (cid, mo, y) => {
        const key = `${cid}_${mo}_${y}`;
        const next = rebuildMonthlyFromDaily(cid, mo, y, stores.entryStore, stores.inspectionStore, stores.meManualStore[key], undefined, stores.receiptStore);
        stores.monthlyStore[key] = next.merged;
        stores.meSourceStore[key] = next.source;
      },
    });
    const h = e.buildSection('crs_page2', e.getData(CRS, m, 2026));
    const rows = [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => [...x[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
    return rows.find((r) => r.includes('B.RICE')) ?? [];
  };
  const sep = render(9, true);
  check(`September B.RICE: Opening ${sep[2]} · Total ${sep[9]} · Sales ${sep[11]} · Closing ${sep[15]}`, sep[2] === '47' && sep[9] === '47' && sep[11] === '46' && sep[15] === '1', J(sep));
  const oct = render(10, true);
  check(`October B.RICE: Opening ${oct[2]} (kgs ${oct[3]}) · Total ${oct[9]} · Closing ${oct[15]}`, oct[2] === '1' && oct[3] === '2316.998' && oct[9] === '1' && oct[15] === '1', J(oct));
  const old = render(10, false);
  check(`without the lookup (the golden path) the builders' own rule stands: ${old[2]} (= 2316.998 ÷ 50)`, old[2] === '46');
}

console.log('\n7. Wiring');
{
  const page = readFileSync(join(root, 'src/app/(app)/monthly-entry/page.tsx'), 'utf8');
  const server = readFileSync(join(root, 'src/lib/payments/server.ts'), 'utf8');
  const legacy = readFileSync(join(root, 'src/legacy/45-bag-counts.js'), 'utf8');
  const gen = readFileSync(join(root, 'tools/build-stmt-module.mjs'), 'utf8');
  check('Monthly Sales: carriedBagsFor → bagRowFor for every row; the bag loop from kgs is gone', /carriedBagsFor\(/.test(page) && /bagRowFor\(sec, c\.id/.test(page) && !/const auto = bagsOf\(kgs\[f\], c\.id\)/.test(page));
  check('its save keeps a typed Opening only where it differs from the carry (dailyBags; g_openFixed on a hand-keyed row)', /r\.g\.open !== r\.gOpenDefault\) typed\.g_open/.test(page) && /g_openFixed = true/.test(page));
  check('the statement server hands the engine bagOpeningLookup', /bagOpening = bagOpeningLookup\(stores/.test(server) && /bagOpening,/.test(server));
  check('45-bag-counts.js takes the carried Opening (STMT_BAG_OPENING), the prelude passes ctx.bagOpening', /STMT_BAG_OPENING\(d\.key, sec, id\)/.test(legacy) && /ctx\.bagOpening/.test(gen));
}

console.log(failures ? `\n${failures} FAILED` : '\nALL BAG-CARRY CHECKS PASSED');
process.exit(failures ? 1 : 0);
