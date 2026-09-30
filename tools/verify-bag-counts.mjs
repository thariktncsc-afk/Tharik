/**
 * A commodity's bag counts on the statements are the ones Monthly Sales shows
 * (office, 2026-09-30; src/legacy/45-bag-counts.js).
 *
 *   node tools/verify-bag-counts.mjs
 *
 * The recording: CRS 19 September, Palm Oil's Opening bags saved as 53 on
 * Monthly Sales — stored and shown again after navigating away — while CRS
 * Page 2 printed 52 (525 kg ÷ 10: its bags() never read a saved count).
 *
 * Through the generated statement engine, synthetic data only:
 *   1. Page 2 / Cost Com print the saved 53 — Opening, Total, Closing;
 *   2. saved 52 → 53 → 54 → back to 52: each save is what prints;
 *   3. Total = Opening + Receipt and Closing = Total − Sales, the grid's own
 *      arithmetic (the office's 13 + 20 = 33, 33 − 5 = 28);
 *   4. a count typed on a FROM-DAILY row (dailyBags) wins, a typed 0 included;
 *      a stored 0 on a hand-keyed row falls back to kgs ÷ pack, as the grid;
 *   5. Free Com and B6 read the same counts (Wheat);
 *   6. nothing saved → kgs ÷ pack size, as before;
 *   7. wiring: the module lists 45-bag-counts.js, the builders call it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const CRS = 19;
const KEY = `${CRS}_9_2026`;
const rowsOf = (h) => [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
const rowWith = (h, label) => rowsOf(h).find((r) => r.includes(label)) ?? [];
// A bag cell sits immediately left of its kgs cell.
const bagBefore = (row, kgs, nth = 0) => { let i = -1; for (let k = 0; k <= nth; k++) i = row.indexOf(kgs, i + 1); return i > 0 ? row[i - 1] : undefined; };

function render(monthlyRow, { manual = {}, id = 'PALM', sections = ['crs_page2', 'cost_com'] } = {}) {
  const e = createStatementEngine({
    stores: {
      entryStore: {}, inspectionStore: {}, monthlyStore: { [KEY]: { a: { [id]: monthlyRow }, b: {} } }, meManualStore: { [KEY]: manual }, meSourceStore: {}, meRemitStore: {},
      meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
  const d = e.getData(CRS, 9, 2026);
  return Object.fromEntries(sections.map((s) => [s, e.buildSection(s, d)]));
}
const palm = (o = {}) => ({ open: 525, receipt: 0, total: 525, sales: 0, close: 525, amount: 0, g_open: 52, g_receipt: 0, g_total: 52, g_sales: 0, g_close: 52, ...o });

console.log('1. The recording: CRS 19 Palm Oil Opening bags saved as 53');
{
  const typed = { a: {}, b: {}, dailyBags: { a: { PALM: { g_open: 53 } } } };
  const r = render(palm({ g_open: 53, g_total: 53, g_close: 53 }), { manual: typed });
  const p2 = rowWith(r.crs_page2, 'P.OIL');
  check(`CRS Page 2 P.OIL: Opening ${p2[2]} · Total ${p2[9]} · Closing ${p2[15]} (kgs 525)`, p2[2] === '53' && p2[3] === '525' && p2[9] === '53' && p2[15] === '53', JSON.stringify(p2));
  const cc = rowWith(r.cost_com, 'P.OIL');
  check(`Cost Com P.OIL: Opening bags ${bagBefore(cc, '525')}`, bagBefore(cc, '525') === '53', JSON.stringify(cc));
}

console.log('\n2. 52 → 53 → 54 → back to 52: what was saved last is what prints');
for (const v of [53, 54, 52]) {
  const manual = v === 52 ? { a: {}, b: {} } : { a: {}, b: {}, dailyBags: { a: { PALM: { g_open: v } } } }; // 52 = kgs ÷ 10: nothing kept
  const r = render(palm({ g_open: v, g_total: v, g_close: v }), { manual });
  const p2 = rowWith(r.crs_page2, 'P.OIL');
  check(`saved ${v} → Page 2 Opening ${p2[2]}, Cost Com ${bagBefore(rowWith(r.cost_com, 'P.OIL'), '525')}`, p2[2] === String(v) && bagBefore(rowWith(r.cost_com, 'P.OIL'), '525') === String(v));
}

console.log('\n3. Total = Opening + Receipt, Closing = Total − Sales (the office\'s 13 + 20 = 33, 33 − 5 = 28)');
{
  // A hand-keyed month (no dailyBags): the grid shows a stored count that differs from kgs ÷ pack.
  const r = render(palm({ open: 100, receipt: 200, total: 300, sales: 50, close: 250, g_open: 13, g_receipt: 20, g_total: 30, g_sales: 5, g_close: 25 }));
  const p2 = rowWith(r.crs_page2, 'P.OIL');
  check(`Page 2: ${p2[2]} + ${p2[4]} = ${p2[9]}, − ${p2[11]} = ${p2[15]} (the stored Total 30 / Closing 25 are not read)`, p2[2] === '13' && p2[4] === '20' && p2[9] === '33' && p2[11] === '5' && p2[15] === '28', JSON.stringify(p2));
}

console.log('\n4. Where a count comes from — as the Monthly Sales grid decides it');
{
  const typed0 = { a: {}, b: {}, dailyBags: { a: { PALM: { g_open: 0 } } } };
  const r0 = render(palm({ g_open: 0, g_total: 0, g_close: 0 }), { manual: typed0 });
  check(`a typed 0 on a FROM-DAILY row prints 0 (kgs 525): ${rowWith(r0.crs_page2, 'P.OIL')[2]}`, rowWith(r0.crs_page2, 'P.OIL')[2] === '0');
  const rs = render(palm({ g_open: 0 }));
  check(`a stored 0 on a hand-keyed row falls back to kgs ÷ 10: ${rowWith(rs.crs_page2, 'P.OIL')[2]}`, rowWith(rs.crs_page2, 'P.OIL')[2] === '52');
}

console.log('\n5. Free Com and B6 read the same counts (Wheat, typed 40 where kgs say 39)');
{
  const wheat = { open: 1972, receipt: 0, total: 1972, sales: 1350, close: 622, amount: 0, g_open: 40, g_receipt: 0, g_total: 40, g_sales: 27, g_close: 13 };
  const typed = { a: {}, b: {}, dailyBags: { a: { WHEAT: { g_open: 40 } } } };
  const r = render(wheat, { manual: typed, id: 'WHEAT', sections: ['crs_page2', 'free_com', 'b6'] });
  const p2 = rowWith(r.crs_page2, 'WHEAT'), fc = rowWith(r.free_com, 'WHEAT'), b6 = rowWith(r.b6, 'WHEAT');
  check(`Page 2 WHEAT Opening ${p2[2]} · Sales ${p2[11]} · Closing ${p2[15]}`, p2[2] === '40' && p2[11] === '27' && p2[15] === '13', JSON.stringify(p2));
  check(`Free Com WHEAT Opening bags ${bagBefore(fc, '1972')}`, bagBefore(fc, '1972') === '40', JSON.stringify(fc));
  check(`B6 WHEAT Opening bags ${bagBefore(b6, '1972')}`, bagBefore(b6, '1972') === '40', JSON.stringify(b6));
}

console.log('\n6. Nothing saved → kgs ÷ pack size, as before');
{
  const r = render({ open: 525, receipt: 304, total: 829, sales: 738, close: 91, amount: 18450 });
  const p2 = rowWith(r.crs_page2, 'P.OIL');
  check(`Page 2 P.OIL ${p2[2]} + ${p2[4]} = ${p2[9]}, sales ${p2[11]}, closing ${p2[15]}`, p2[2] === '52' && p2[4] === '30' && p2[9] === '82' && p2[11] === '73' && p2[15] === '9', JSON.stringify(p2));
}

console.log('\n7. Wiring');
const b = readFileSync(join(root, 'tools/build-stmt-module.mjs'), 'utf8');
const s12 = readFileSync(join(root, 'src/legacy/12-statement-builders.js'), 'utf8');
check('the statement module is built with 45-bag-counts.js', b.includes("'45-bag-counts.js'"));
check('CRS Page 2 no longer divides kgs for its bag columns', !/Math\.floor\(\w+\/bagDiv\(/.test(s12.slice(s12.indexOf('function buildCrsPage2'), s12.indexOf('function buildGunny'))));
check('Page 2, Free Com, Cost Com and B6 all call stmtBagCounts', (s12.match(/stmtBagCounts\(/g) ?? []).length >= 5);

console.log(failures ? `\n${failures} FAILED` : '\nALL BAG-COUNT CHECKS PASSED');
process.exit(failures ? 1 : 0);
