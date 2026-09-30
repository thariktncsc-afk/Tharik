/**
 * The month's reconciliation (office, 2026-09-30).
 *
 *   node tools/verify-reconcile.mjs
 *
 *   Expected = POS sales + TEA / SALT (keyed by hand) + Police + C.Box / Poly
 *   Excess   = actual remittance − Expected       (negative = short, never hidden)
 *
 * C.Box / Poly is what the grid sold (Empty Card+Box / Empty Polythene Bag);
 * when a shop keyed none there, the Monthly Remittance "Poly Gunny & C.Box"
 * row. Police is included. CRS Page 2's TOTAL is Expected, and Page 2, Cost
 * Com and Sale Tax print the same Excess. Checked through the real engine with
 * synthetic stores (the office's own worked example), no database:
 *   1. 62389 + 2000 + 500 = 64889; 64800 banked → −89; corrected to 64900 → +11;
 *   2. where C.Box / Poly comes from; Police included; nothing banked;
 *   3. the same Excess on Page 2, Cost Com and Sale Tax, TOTAL = Expected;
 *   4. the popup's wording and its reasons, worked out from the figures;
 *   5. the wiring: the route, the popup on both screens, refreshed on a save;
 *   6. the Daily Sale sheet: sales priced at the saved rate, Police once, no
 *      inspection kilos in the EXCESS column, TOTAL = Page 2, EXCESS = paid − TOTAL.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);
const Rc = await import(pathToFileURL(join(root, 'src/lib/statements/reconcile.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const CRS = 8;
const KEY = `${CRS}_9_2026`;
const txt = (h) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/,/g, '').replace(/\s+/g, ' ');
const num = (re, s) => { const m = s.match(re); return m ? Number(m[1]) : NaN; };

// The office's example: POS 62,389 · TEA/SALT 2,000 · C.Box/Poly 500.
const row = (sales, amount) => ({ open: 0, receipt: 0, total: 0, sales, close: 0, amount });
function month({ pos = 62389, tea = 2000, polyBags = 200, police = 0 } = {}) {
  const a = { SUGAR: row(pos / 25, pos), OOTY: row(tea / 25, tea) };
  if (polyBags) a.EMPTY_BAG = row(polyBags, polyBags * 2.5);
  const b = police ? { PB_SUGAR: row(police / 12.5, police) } : {};
  return { [KEY]: { a, b } };
}
function run(monthly, remit, extra = {}) {
  const e = createStatementEngine({
    stores: {
      entryStore: {}, inspectionStore: {}, monthlyStore: monthly, meManualStore: {}, meSourceStore: {},
      meRemitStore: remit === null ? {} : { [KEY]: { 3: { nonCereal: remit, remitDate: '2026-09-30' }, extra } }, meGunnyStore: {}, meCardStore: {},
      salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
  const d = e.getData(CRS, 9, 2026);
  const r = e.reconcile(d);
  const p2 = txt(e.buildSection('crs_page2', d)), cc = txt(e.buildSection('cost_com', d)), st = txt(e.buildSection('sale_tax', d));
  return {
    r,
    page2: { total: num(/TOTAL ([\d.-]+) EXCESS/, p2), excess: num(/EXCESS ([\d.-]+) Remittance Amount/, p2), remit: num(/Remittance Amount ([\d.-]+)/, p2) },
    costCom: num(/EXCESS (-?[\d.]+)/, cc),
    saleTax: num(/EXCESS (-?[\d.]+) GRAND TOTAL/, st),
  };
}

console.log('1. The office\'s example');
const short = run(month(), 64800);
check(`POS ${short.r.pos} + TEA/SALT ${short.r.manual} + C.Box/Poly ${short.r.pack} = Expected ${short.r.expected}`, short.r.pos === 62389 && short.r.manual === 2000 && short.r.pack === 500 && short.r.expected === 64889);
check(`64800 banked → Excess ${short.r.excess}`, short.r.excess === -89);
const fixed = run(month(), 64900);
check(`corrected to 64900 → Excess ${fixed.r.excess}, and no reason to give`, fixed.r.excess === 11 && Rc.reconcileReasons(fixed.r).length === 0);

console.log('\n2. Where each part comes from');
// The shop banked 64,389 over the days and the 500 on the Poly Gunny & C.Box row: 64,889 in all.
const viaRow = run(month({ polyBags: 0 }), 64389, { e1nc: 500 });
check(`no C.Box/Poly sold on the grid: the remittance's "Poly Gunny & C.Box" 500 counts (${viaRow.r.packSource}) → Excess ${viaRow.r.excess}`, viaRow.r.pack === 500 && viaRow.r.packSource === 'remittance' && viaRow.r.excess === 0);
const both = run(month(), 64389, { e1nc: 500 });
check(`sold on the grid AND a remittance row: the grid's counts, once (${both.r.packSource} ${both.r.pack})`, both.r.packSource === 'grid' && both.r.pack === 500 && both.r.expected === 64889);
const pol = run(month({ police: 97.5 }), 64889);
check(`Police sales are included: Expected ${pol.r.expected} (+97.50) → Excess ${pol.r.excess}`, pol.r.police === 97.5 && pol.r.expected === 64986.5 && pol.r.excess === -97.5);
const nothing = run(month(), null);
check(`nothing banked: Excess ${nothing.r.excess} (the whole Expected, shown — never 0)`, nothing.r.remit === 0 && nothing.r.excess === -64889);

console.log('\n3. One Excess on every sheet');
for (const [name, x] of [['short', short], ['corrected', fixed], ['police', pol]]) {
  check(`${name}: Page 2 TOTAL ${x.page2.total} = Expected; EXCESS Page 2 ${x.page2.excess} = Cost Com ${x.costCom} = Sale Tax ${x.saleTax} = ${x.r.excess}; Remittance Amount ${x.page2.remit}`,
    x.page2.total === x.r.expected && x.page2.excess === x.r.excess && x.costCom === x.r.excess && x.saleTax === x.r.excess && x.page2.remit === x.r.remit, JSON.stringify(x.page2));
}

console.log('\n4. The popup');
const msg = Rc.reconcileMessage(short.r);
console.log('        ' + msg.split('\n').join('\n        '));
check('opens with Statement Amount / Actual Remittance / Difference, then the breakdown', /^Statement Amount: ₹64,889\.00\nActual Remittance: ₹64,800\.00\nDifference: -₹89\.00/.test(msg) && /• POS Sales Amount: ₹62,389\.00/.test(msg) && /• TEA\/SALT Manual Amount: ₹2,000\.00 \(OOTY \(tea\) ₹2,000\.00\)/.test(msg) && /• C\.Box\/Poly Amount: ₹500\.00/.test(msg) && /• Expected Total: ₹64,889\.00/.test(msg) && /lower than the calculated amount/.test(msg));
check(`a shortfall with no single cause says so plainly: "${Rc.reconcileReasons(short.r)[0]}"`, /₹89\.00 less than POS \+ TEA\/SALT \+ Police \+ C\.Box\/Poly/.test(Rc.reconcileReasons(short.r)[0]));
const polR = Rc.reconcileReasons(pol.r);
check(`a shortfall equal to one part names it: "${polR[0]}"`, /exactly the Police sales \(₹97\.50\)/.test(polR[0]));
const teaShort = run(month(), 62889);
check(`…the tea / salt money: "${Rc.reconcileReasons(teaShort.r)[0]}"`, /exactly the (TEA \/ SALT sales keyed by hand|OOTY \(tea\) sales) \(₹2,000\.00\)/.test(Rc.reconcileReasons(teaShort.r)[0]));
const pair = run(month(), 62389);
check(`…two parts together: "${Rc.reconcileReasons(pair.r)[0]}"`, /\+/.test(Rc.reconcileReasons(pair.r)[0]) && /₹2,500\.00/.test(Rc.reconcileReasons(pair.r)[0]));
check(`nothing banked says so: "${Rc.reconcileReasons(nothing.r)[0]}"`, /No remittance is saved/.test(Rc.reconcileReasons(nothing.r)[0]));
const dayWise = Rc.reconcileReasons({ ...short.r, days: [{ date: '2026-09-01', sales: 1000, remit: 1000 }, { date: '2026-09-02', sales: 900, remit: 811 }] });
check(`a month keyed by day names the days banked below their sales: "${dayWise.find((x) => /Banked less/.test(x))}"`, dayWise.some((x) => /Banked less than sold on 1 day: 02-09-2026 sold ₹900\.00, banked ₹811\.00/.test(x)));

console.log('\n5. Wiring');
const route = readFileSync(join(root, 'src/app/api/statements/reconcile/route.ts'), 'utf8');
check('the route: signed in, a shop user only for their own shop, the engine\'s own reconcile', /if \(!session\)/.test(route) && /That is not your shop/.test(route) && /engine\.reconcile\(engine\.getData\(crsId, month, year\)\)/.test(route));
const note = readFileSync(join(root, 'src/components/ReconcileNotice.tsx'), 'utf8');
check('the popup opens only when short, once per shop-month-figure', /if \(next && next\.excess < 0\)/.test(note) && /shown\.has\(key\)/.test(note));
check('refreshed when a save of the figures lands (the SAVED stores)', /useSavedStore\('meRemitStore'\)/.test(note) && /useSavedStore\('entryStore'\)/.test(note) && /useSavedStore\('monthlyStore'\)/.test(note));
check('on the Statements page and on Monthly Remittance', /<ReconcileNotice crsId=\{crsId\} month=\{month\} year=\{year\} \/>/.test(readFileSync(join(root, 'src/app/(app)/statements/page.tsx'), 'utf8')) && /<ReconcileNotice crsId=\{ctx\.crsId\} month=\{ctx\.month\} year=\{ctx\.year\} \/>/.test(readFileSync(join(root, 'src/app/(app)/monthly-entry/RemitTable.tsx'), 'utf8')));

console.log('\n6. The Daily Sale sheet (office, 2026-09-30: CRS 5 September)');
// One day sheet on 29-09 as CRS 5 keyed it, a 13 kg shortage (SUGAR 9 + PALM 4)
// on that date, the Poly & C.Box row 90 and the month banked 62,472.
const MASTER = [
  { id: 'SUGAR', rate: 25 }, { id: 'AAY_SUGAR', rate: 13.5 }, { id: 'TOOR', rate: 30 }, { id: 'PALM', rate: 25 },
  { id: 'SALT_CIS', rate: 10 }, { id: 'PB_TOOR', rate: 15 }, { id: 'PB_SUGAR', rate: 12.5 }, { id: 'PB_PALM', rate: 12.5 },
  { id: 'EMPTY_BOX', rate: 0.6 }, { id: 'EMPTY_BAG', rate: 2.5 },
];
function dailySale(master) {
  const K = '5_9_2026', DAY = '5_2026-09-29';
  const A = { BRA: 5814, SUGAR: 1031.5, AAY_SUGAR: 27, TOOR: 616, PALM: 616, SALT_CIS: 225 }, B = { PB_BRA: 18, PB_TOOR: 4, PB_SUGAR: 2, PB_PALM: 1 };
  // The sheet's stored amounts are deliberately WRONG: the sheet must price sales at the saved rate, not read them.
  const sec = (o) => Object.fromEntries(Object.entries(o).map(([id, s]) => [id, { open: 0, receipt: 0, total: 0, sales: s, close: 0, amount: 1 }]));
  const e = createStatementEngine({
    stores: {
      entryStore: { [DAY]: { a: sec(A), b: sec(B), remits: [] } },
      inspectionStore: { [DAY]: { a: { SUGAR: { shortage: 9 }, PALM: { shortage: 4 } } } },
      monthlyStore: { [K]: { a: sec(A), b: sec(B) } }, meManualStore: {}, meSourceStore: {},
      meRemitStore: { [K]: { 29: { nonCereal: 62382, remitDate: '2026-09-29' }, extra: { e1nc: 90, e1date: '2026-09-29' } } },
      meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
    commodityMaster: master,
  });
  const d = e.getData(5, 9, 2026);
  const html = e.buildSection('crs_daily_sale', d);
  const tx = txt(html);
  const cells = (tr) => tr.match(/<td[^>]*>(.*?)<\/td>/g).map((c) => c.replace(/<[^>]+>/g, ''));
  const day29 = cells(html.split('<tr>').find((r) => r.includes('29/09/2026')));
  const total = cells(html.match(/<tr class="total-row">([\s\S]*?)<\/tr>/)[0]);
  return {
    r: e.reconcile(d), html, page2: num(/TOTAL ([\d.-]+) EXCESS/, txt(e.buildSection('crs_page2', d))),
    daySales: Number(day29[18]), dayExcessCell: day29[20], totalExcess: Number(total[total.length - 2]), paid: Number(total[total.length - 1]),
    sales: num(/TOTAL AMOUNT OF DAILY SALES ([\d.]+)/, tx), police: num(/CRS POLICE \+ JAGGERY ([\d.]+)/, tx),
    cbox: num(/C\.BOX \+ P\.GUNNY \+ EXCESS ([\d.]+)/, tx), grand: num(/C\.BOX \+ P\.GUNNY \+ EXCESS [\d.]+ TOTAL ([\d.]+)/, tx),
  };
}
const ds = dailySale(MASTER);
check(`29-09's TOTAL AMOUNT = chargeable Section A sales × saved rate: 1031.5×25 + 27×13.5 + 616×30 + 616×25 + SALT CIS 225×10 = ${ds.daySales} (not the stored amounts, not Police)`, ds.daySales === 62282);
check(`the 13 kg shortage (SUGAR 9 + PALM 4) is not printed: 29-09's EXCESS cell "${ds.dayExcessCell}", no "-13" anywhere`, ds.dayExcessCell === '' && !/>-13</.test(ds.html));
check(`footer: DAILY SALES ${ds.sales} + POLICE ${ds.police} (once) + C.BOX/P.GUNNY ${ds.cbox} = TOTAL ${ds.grand}`, ds.sales === 62282 && ds.police === 97.5 && ds.cbox === 90 && ds.grand === 62469.5);
check(`TOTAL = CRS Page 2 TOTAL ${ds.page2} = Expected ${ds.r.expected}`, ds.grand === ds.page2 && ds.grand === ds.r.expected);
check(`TOTAL row EXCESS ${ds.totalExcess} = paid in bank ${ds.paid} − TOTAL, = the reconciliation's Excess ${ds.r.excess}; remittance untouched`, ds.paid === 62472 && ds.totalExcess === 2.5 && ds.r.excess === 2.5);
const dsRate = dailySale(MASTER.map((m) => (m.id === 'SUGAR' ? { ...m, rate: 26 } : m)));
check(`a rate changed on the Commodities screen (SUGAR 25 → 26) follows on its own: sales ${dsRate.sales} (+1031.50), Page 2 TOTAL ${dsRate.page2}, Excess ${dsRate.totalExcess}`, dsRate.sales === 63313.5 && dsRate.page2 === dsRate.grand && dsRate.totalExcess === dsRate.r.excess && dsRate.totalExcess === -1029);
const dsNoMaster = dailySale([]);
check(`no saved master: the engine's compiled rates (SALT CIS 12) — sales ${dsNoMaster.sales}`, dsNoMaster.sales === 62282 + 225 * 2);

console.log('\n7. Cost Com never prints a negative CLOSING BALANCE (office, 2026-09-30)');
{
  // CRS 5 September as stored: C.Box 62 / Poly 22 sold with no grid stock → close −62 / −22;
  // and a kgs commodity whose stored close is below zero too.
  const rowOf = (o) => ({ open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0, ...o });
  const a = { EMPTY_BOX: rowOf({ sales: 62, close: -62, amount: 37.2 }), EMPTY_BAG: rowOf({ sales: 22, close: -22, amount: 55 }), SUGAR: rowOf({ open: 10, total: 10, sales: 15, close: -5, amount: 375 }) };
  const stores = {
    entryStore: {}, inspectionStore: {}, monthlyStore: { [KEY]: { a, b: {} } }, meManualStore: {}, meSourceStore: {},
    meRemitStore: { [KEY]: { 3: { nonCereal: 467.2, remitDate: '2026-09-30' } } }, meGunnyStore: {}, meCardStore: {},
    salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
  };
  const e = createStatementEngine({ stores, users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null });
  const d = e.getData(CRS, 9, 2026);
  const html = e.buildSection('cost_com', d);
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1]));
  const row = (label) => rows.find((r) => r[1] === label) ?? [];
  const box = row('C.BOX'), poly = row('POLY'), sugar = row('SUGAR');
  check(`C.BOX CB "${box[13]}", POLY CB "${poly[13]}" (stored −62 / −22)`, box[13] === '0' && poly[13] === '0');
  check(`a kgs row below zero prints 0 too: SUGAR CB bags "${sugar[13]}", kgs "${sugar[14]}"`, sugar[13] === '0' && sugar[14] === '0');
  check(`no negative figure anywhere on the sheet but EXCESS`, rows.every((r) => r[1] === 'EXCESS' || r.every((c) => !/^-\d/.test(c))));
  check(`display only: the stored close is still −62 / −22 / −5, and the amounts stand (C.BOX ${box[12]}, POLY ${poly[12]}, SUGAR ${sugar[12]})`,
    d.getVal('EMPTY_BOX', 'close') === -62 && d.getVal('EMPTY_BAG', 'close') === -22 && d.getVal('SUGAR', 'close') === -5 && box[12] === '37.2' && poly[12] === '55' && sugar[12] === '375');
  const p2 = e.buildSection('crs_page2', d);
  check('other sheets unchanged: CRS Page 2 still prints its own closing (-5 for SUGAR)', /<td[^>]*>-5(\.0+)?<\/td>/.test(p2));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll reconcile checks passed.');
process.exitCode = failures ? 1 : 0;
