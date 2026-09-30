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

function render(entryStore, meRemitStore) {
  const e = createStatementEngine({
    stores: {
      entryStore, inspectionStore: {}, monthlyStore: monthly, meManualStore: {}, meSourceStore: {}, meRemitStore, meGunnyStore: {}, meCardStore: {},
      salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
  const d = e.getData(CRS, 9, 2026);
  const p2 = txt(e.buildSection('crs_page2', d));
  const rm = txt(e.buildSection('remittance', d));
  const num = (re, s) => { const m = s.match(re); return m ? Number(m[1]) : 0; };
  return {
    sales: num(/Sales Amount ([\d.-]+)/, p2),
    total: num(/TOTAL ([\d.-]+) EXCESS/, p2),
    excess: num(/EXCESS ([\d.-]+) Remittance Amount/, p2),
    remit: num(/Remittance Amount ([\d.-]+)/, p2),
    sheetTotal: num(/TOTAL ([\d.]+)\s*$/, rm),
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
  check(`${label}: Remittance Amount ${r.remit} = sheet TOTAL ${r.sheetTotal} = ${want}`, r.remit === want && r.sheetTotal === want, JSON.stringify(r));
}
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

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll remit-total checks passed.');
process.exitCode = failures ? 1 : 0;
