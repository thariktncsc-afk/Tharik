/**
 * Remittance transaction rules.
 *
 *   node tools/verify-remittance.mjs
 *
 * The one that matters most is the last group: an additional deposit's reason
 * is a LABEL, and must never be counted as money — not in the month's Cereal
 * total, and not in what the day sheet hands the statement engine.
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

const R = await import(pathToFileURL(join(root, 'src/lib/engine/remittance.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const CRS = 1;
const SALES = '2026-09-01';
const t = (amount, date, extra = {}) => ({ id: R.newRemitId(), amount, date, account: 'nc', ...extra });

// The worked example from the brief: ₹1,000 on the day, then four late ones.
const sheet = {
  remits: [
    t(1000, '2026-09-01'),
    t(500, '2026-09-02', { reason: 'Missed' }),
    t(200, '2026-09-03', { reason: 'Tea' }),
    t(100, '2026-09-04', { reason: 'Salt' }),
    t(50, '2026-09-05', { reason: 'C.Box' }),
  ],
};
const rows = R.txnsOf(sheet, SALES);

console.log('one sales date, many deposits');
check('all five deposits are kept as separate rows', rows.length === 5);
check('every row keeps the ORIGINAL sales date', rows.every((r) => r.salesDate === SALES));
check('each keeps its own remittance date', rows.map((r) => r.date).join() === '2026-09-01,2026-09-02,2026-09-03,2026-09-04,2026-09-05');
check('the first is not additional; the rest are', !rows[0].additional && rows.slice(1).every((r) => r.additional));
check('the first deposit is never overwritten by a later one', rows[0].amount === 1000 && rows[0].reason === undefined);
check('ids are unique, so a re-save edits rather than duplicates', new Set(rows.map((r) => r.id)).size === 5);

console.log('column mapping — amount is Non-Cereal, reason is only a label');
for (const r of rows.slice(1)) {
  const { nc, ce } = R.amounts(r);
  check(`${r.reason}: ₹${r.amount} stays in Non-Cereal, Cereal carries no money`, nc === r.amount && ce === 0);
}
// Daily Entry no longer offers a Cereal destination, but sheets saved when it
// did must keep reading back the way they were entered.
const plainCereal = R.amounts({ ...t(700, SALES, { account: 'ce' }), salesDate: SALES, additional: false });
check('a legacy Cereal deposit still lands in Cereal', plainCereal.ce === 700 && plainCereal.nc === 0);
check('a legacy Cereal row carrying a reason is still Non-Cereal', R.amounts({ ...t(300, SALES, { account: 'ce', reason: 'Tea' }), salesDate: SALES, additional: true }).nc === 300);

console.log('totals');
const totNC = rows.reduce((s, r) => s + R.amounts(r).nc, 0);
const totCE = rows.reduce((s, r) => s + R.amounts(r).ce, 0);
check('Non-Cereal totals 1000+500+200+100+50 = 1850', totNC === 1850, `got ${totNC}`);
check('the reasons contribute nothing to the Cereal total', totCE === 0, `got ${totCE}`);

const st = R.sheetTotals(sheet.remits);
check('the sheet reports the whole 1850 to the statement engine', st.remitAmount === 1850, JSON.stringify(st));
check('remitCereal stays money-only (0 here), never a reason', st.remitCereal === 0);
check('remitNonCereal carries all five', st.remitNonCereal === 1850);
check('remitDate is the earliest deposit', st.remitDate === '2026-09-01');

console.log('a reason is never mistaken for a value');
check('"Missed" is not a number', R.amounts(rows[1]).ce === 0 && Number.isFinite(R.amounts(rows[1]).nc));
check('an unknown reason string is rejected', R.txnsOf({ remits: [t(10, SALES, { reason: 'Nonsense' })] }, SALES)[0].reason === undefined);

console.log('sheets saved before transactions existed');
check('a bare remits array still reads, with stable ids', R.txnsOf({ remits: [{ amount: 300, date: SALES }] }, SALES)[0].id === `${SALES}#0`);
check('a legacy remitAmount-only sheet still reads', R.txnsOf({ remitAmount: 1000, remitDate: SALES }, SALES)[0].amount === 1000);
check('an empty sheet yields nothing', R.txnsOf({}, SALES).length === 0 && R.txnsOf(undefined, SALES).length === 0);

console.log('the month view');
const store = { [`${CRS}_${SALES}`]: sheet, [`${CRS}_2026-09-02`]: { remits: [t(2000, '2026-09-02')] } };
const all = R.monthTxns(store, CRS, 9, 2026);
check('deposits from every day of the month are gathered', all.length === 6);
check('they come back in sales-date order', all[0].salesDate === SALES && all[5].salesDate === '2026-09-02');
check('a later deposit stays under its SALES date, not its bank date', all.filter((r) => r.salesDate === SALES).length === 5);
check('another shop\'s sheets are not picked up', R.monthTxns({ '11_2026-09-01': sheet }, 1, 9, 2026).length === 0);

console.log(failures === 0 ? '\nREMITTANCE OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
