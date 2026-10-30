/**
 * CRS Page 2's "Remittance Amount" is the month's actual deposits — the
 * Remittance sheet's own TOTAL (office, 2026-09-30).
 *
 *   node tools/verify-remit-total.mjs
 *
 * It used to add up the Monthly Remittance table's hand-keyed rows only and,
 * when those came to nothing, print the sheet's TOTAL instead. A shop keyed by
 * day keeps its deposits on the day sheets: CRS 8, September 2026, printed
 * 55061.30 (its TOTAL) where the Remittance sheet — the deposits — says 55095.
 * Checked through the real engine, synthetic stores, no database:
 *   1. day-sheet deposits only · hand-keyed rows only · both · extra rows ·
 *      several deposits on one date · none at all;
 *   2. Page 2's Remittance Amount = the Remittance sheet's TOTAL in every case,
 *      and never TOTAL when there is no remittance;
 *   3. a deposit added / corrected / removed moves it on the next render;
 *   4. Sales Amount, TOTAL and the EXCESS formula are unchanged.
 */
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
const CRS = 8;
const KEY = `${CRS}_9_2026`;
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// September with sales worth 1000 (Sugar 40 kg at 25) — TOTAL 1000.00.
const monthly = { [KEY]: { a: { SUGAR: { open: 100, receipt: 0, total: 100, sales: 40, close: 60, amount: 1000 } }, b: {} } };
const sheet = (remits) => ({ a: { SUGAR: { open: 100, receipt: 0, total: 100, sales: 40, close: 60, amount: 1000 } }, b: {}, remits, remitAmount: remits.reduce((t, r) => t + r.amount, 0), remitDate: remits[0]?.date ?? '' });

function render(entryStore, meRemitStore, crs = CRS) {
  const e = createStatementEngine({
    stores: {
      entryStore, inspectionStore: {}, monthlyStore: monthly, meManualStore: {}, meSourceStore: {}, meRemitStore, meGunnyStore: {}, meCardStore: {},
      salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
  const d = e.getData(crs, 9, 2026);
  const p2 = txt(e.buildSection('crs_page2', d));
  const cc = txt(e.buildSection('cost_com', d)).replace(/,/g, '');
  const st = txt(e.buildSection('sale_tax', d)).replace(/,/g, '');
  const rm = txt(e.buildSection('remittance', d));
  const num = (re, s) => { const m = s.match(re); return m ? Number(m[1]) : 0; };
  return {
    sales: num(/Sales Amount ([\d.-]+)/, p2),
    total: num(/TOTAL ([\d.-]+) EXCESS/, p2),
    excess: num(/EXCESS ([\d.-]+) Remittance Amount/, p2),
    remit: num(/Remittance Amount ([\d.-]+)/, p2),
    sheetTotal: num(/TOTAL ([\d.]+)\s*$/, rm),
    // Cost Com prints its rate column's dash before the figure: "NET TOTAL - 600".
    costNet: num(/NET TOTAL (?:[-–—] )?([\d.]+)/, cc),
    saleTaxGrand: num(/GRAND TOTAL ([\d.]+)/, st),
    c29: num(/Remittance Amount ([\d.,]+)/, p2.replace(/,/g, '')),
    rm,
  };
}
const dep = (amount, date = '2026-09-02') => ({ id: `r${amount}`, amount, date, account: 'nc' });

console.log('1–2. Remittance Amount = the Remittance sheet TOTAL');
const cases = [
  ['day-sheet deposits only (CRS 8\'s case): 600 on 01-09, 430 on 02-09', { [`${CRS}_2026-09-01`]: sheet([dep(600, '2026-09-02')]), [`${CRS}_2026-09-02`]: sheet([dep(430, '2026-09-03')]) }, {}, 1030],
  ['hand-keyed Monthly Remittance rows only', {}, { [KEY]: { 3: { nonCereal: 500, remitDate: '2026-09-04' }, 4: { nonCereal: 520 } } }, 1020],
  ['both: a day sheet\'s deposit and a hand-keyed row for another date', { [`${CRS}_2026-09-01`]: sheet([dep(600)]) }, { [KEY]: { 3: { nonCereal: 450 } } }, 1050],
  ['extra rows (Poly & C.Box 90, Inspection Charges 10) count', { [`${CRS}_2026-09-01`]: sheet([dep(1000)]) }, { [KEY]: { extra: { e1nc: 90, e2nc: 10 } } }, 1100],
  ['several deposits on one sales date all count', { [`${CRS}_2026-09-01`]: sheet([dep(700), dep(333.5, '2026-09-05')]) }, {}, 1033.5],
];
for (const [label, es, rs, want] of cases) {
  const r = render(es, rs);
  check(`${label}: Remittance Amount ${r.remit} = sheet TOTAL ${r.sheetTotal} = Cost Com NET TOTAL ${r.costNet} = Sale Tax GRAND TOTAL ${r.saleTaxGrand} = ${want}`, r.remit === want && r.sheetTotal === want && r.costNet === want && r.saleTaxGrand === want, JSON.stringify(r));
}
const c29 = render({ '29_2026-09-01': sheet([dep(600)]) }, { '29_9_2026': { extra: { e1nc: 90 } } }, 29);
check(`CRS 29's Page 2 counts the extra rows too: ${c29.c29} = its Remittance sheet TOTAL ${c29.sheetTotal}`, c29.c29 === 690 && c29.sheetTotal === 690, JSON.stringify(c29));
const none = render({}, {});
check(`no remittance at all: Remittance Amount ${none.remit || 'blank'} — never the TOTAL (${none.total})`, none.remit === 0 && none.total === 1000, JSON.stringify(none));

console.log('\n3. A deposit added, corrected or removed moves it');
const base = { [`${CRS}_2026-09-01`]: sheet([dep(600)]) };
const added = { [`${CRS}_2026-09-01`]: sheet([dep(600), dep(55, '2026-09-06')]) };
const fixed = { [`${CRS}_2026-09-01`]: sheet([dep(650)]) };
const gone = { [`${CRS}_2026-09-01`]: sheet([]) };
check(`600 → added 55: ${render(base, {}).remit} → ${render(added, {}).remit}`, render(base, {}).remit === 600 && render(added, {}).remit === 655);
check(`corrected to 650: ${render(fixed, {}).remit}`, render(fixed, {}).remit === 650);
check(`removed: ${render(gone, {}).remit || 'blank'} (not the TOTAL)`, render(gone, {}).remit === 0);

console.log('\n4. The other figures are unchanged');
const r = render({ [`${CRS}_2026-09-01`]: sheet([dep(1033.7)]) }, {});
check(`Sales Amount ${r.sales} and TOTAL ${r.total} as before`, r.sales === 1000 && r.total === 1000);
check(`EXCESS keeps its formula: Remittance − TOTAL = ${r.excess}`, Math.abs(r.excess - 33.7) < 0.005, JSON.stringify(r));

console.log('\n5. A C.Box deposit prints in POLY GUNNY & C.BOX, never inside its date (office, 2026-10-30)');
const cbox = (amount, date = '2026-09-30', reason = 'C.Box') => ({ id: `c${amount}`, amount, date, account: 'nc', reason });
// The sheet's rows as text: "| sno | sales date | remit date | … | amount |".
const rows = (rm) => (rm.match(/<tr[\s\S]*?<\/tr>/g) || []).map((r) => r.replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ').replace(/\|( ?\|)+/g, '|').trim());
const dayRow = (o, dd) => rows(o.rmHtml).find((r) => r.startsWith(`|${dd}|${dd}/09/2026|`));
const polyRow = (o) => rows(o.rmHtml).find((r) => r.includes('POLY GUNNY & C.BOX'));
function renderHtml(entryStore, meRemitStore) {
  const o = render(entryStore, meRemitStore);
  const e = createStatementEngine({
    stores: {
      entryStore, inspectionStore: {}, monthlyStore: monthly, meManualStore: {}, meSourceStore: {}, meRemitStore, meGunnyStore: {}, meCardStore: {},
      salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
  return { ...o, rmHtml: e.buildSection('remittance', e.getData(CRS, 9, 2026)) };
}
const both = renderHtml({ [`${CRS}_2026-09-30`]: sheet([dep(515, '2026-09-30'), cbox(150)]) }, {});
check(`CRS 20's case: the date row prints 515 (${dayRow(both, 30)})`, /^\|30\|30\/09\/2026\|30\/09\/2026\|515(\.00)?\|515(\.00)?\|$/.test(dayRow(both, 30) || ''), dayRow(both, 30));
check(`…POLY GUNNY & C.BOX prints 150, dated 30-09 (${polyRow(both)})`, /\|30\/09\/2026\|POLY GUNNY & C\.BOX\|150(\.00)?\|$/.test(polyRow(both) || ''), polyRow(both));
check('…no row prints the two together (665)', !rows(both.rmHtml).some((r) => /\|665(\.00)?\|/.test(r) && !/TOTAL/.test(r)));
check(`…the TOTAL is still every deposit: sheet ${both.sheetTotal} = Remittance Amount ${both.remit} = 665`, both.sheetTotal === 665 && both.remit === 665);
const only = renderHtml({ [`${CRS}_2026-09-28`]: sheet([cbox(130, '2026-09-27')]) }, {});
check(`a date whose only deposit is C.Box prints blank (${dayRow(only, 28)}); 130 in POLY GUNNY & C.BOX dated 27-09`, dayRow(only, 28) === '|28|28/09/2026|' && /\|27\/09\/2026\|POLY GUNNY & C\.BOX\|130(\.00)?\|$/.test(polyRow(only) || '') && only.sheetTotal === 130, `${dayRow(only, 28)} / ${polyRow(only)}`);
const withHand = renderHtml({ [`${CRS}_2026-09-30`]: sheet([dep(515, '2026-09-30'), cbox(150)]) }, { [KEY]: { extra: { e1nc: 90, e1date: '2026-09-15' } } });
check(`a hand-keyed Poly & C.Box row adds to it, keeping its own date (${polyRow(withHand)}), TOTAL ${withHand.sheetTotal}`, /\|15\/09\/2026\|POLY GUNNY & C\.BOX\|240(\.00)?\|$/.test(polyRow(withHand) || '') && withHand.sheetTotal === 755 && withHand.remit === 755, polyRow(withHand));
const missed = renderHtml({ [`${CRS}_2026-09-30`]: sheet([dep(515, '2026-09-30'), cbox(80, '2026-09-30', 'Missed')]) }, {});
check(`a Missed deposit stays on its date — it has no row of its own (${dayRow(missed, 30)})`, /\|595(\.00)?\|$/.test(dayRow(missed, 30) || '') && /POLY GUNNY & C\.BOX\|$/.test(polyRow(missed) || ''), `${dayRow(missed, 30)} / ${polyRow(missed)}`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll remit-total checks passed.');
process.exitCode = failures ? 1 : 0;
