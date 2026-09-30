/**
 * Monthly Remittance's own Save button (office, 2026-09-29).
 *
 *   node tools/verify-remittance-save.mjs
 *
 * The hand-keyed rows (days with no deposit on a day sheet, and the three
 * extra rows) are checked by Daily Entry's rule, saved, and the tick waits for
 * the database. No database, nothing live. Checked:
 *   1. the rule: an amount above zero needs its date, a date needs an amount,
 *      amounts are numbers of 0 or more; a day sheet's deposits are not judged;
 *   2. a saved hand-keyed row reaches the statement through the existing flow
 *      (stmtGetData's remitByDay and the Remittance section), and a day sheet's
 *      deposit still wins its own date;
 *   3. the wiring: one record per day (a second Save cannot add one), the tick
 *      only after saveConfirmed(), per-month row keys, figures written as typed,
 *      the admin ✎ / ✕ / ➕ untouched, the TOTAL row no longer shaded on hover.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(s,c,n){if(s.startsWith('@/'))return n(${JSON.stringify(srcUrl)}+s.slice(2)+(/\\.[a-z]+$/.test(s)?'':'.ts'),c);return n(s,c);}`,
  )}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { remitMonthProblems } = await imp('src/app/(app)/monthly-entry/lib.ts');
const { remittanceMonthSaved } = await imp('src/lib/saveSuccess.ts');
const { createStatementEngine } = await imp('src/generated/statements-legacy.js');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const J = JSON.stringify;
const ctx = { month: 9, year: 2026 };
const none = new Set();

console.log('1. What Save refuses (Daily Entry\'s rule, row by row)');
{
  check('an empty month: nothing to refuse', remitMonthProblems({}, none, ctx).length === 0);
  const ok = remitMonthProblems({ 27: { remitDate: '2026-09-28', nonCereal: 980 }, 28: { remitDate: '2026-09-29', nonCereal: 0, cereal: '150' } }, none, ctx);
  check('amount + date (Non-Cereal, or Cereal alone): saved', ok.length === 0, J(ok));
  const noDate = remitMonthProblems({ 27: { nonCereal: 980 } }, none, ctx);
  check(`an amount without a date: "${noDate[0]}"`, noDate.length === 1 && /^27-09-2026: Please select the Remittance Date\.$/.test(noDate[0]));
  const noAmt = remitMonthProblems({ 28: { remitDate: '2026-09-29', nonCereal: 0 } }, none, ctx);
  check(`a date without an amount: "${noAmt[0]}"`, noAmt.length === 1 && /^28-09-2026: Please enter the Remittance Amount/.test(noAmt[0]));
  const neg = remitMonthProblems({ 3: { remitDate: '2026-09-04', nonCereal: -50 } }, none, ctx);
  check('a negative amount is refused', neg.length === 1 && /03-09-2026: the Non-Cereal amount must be a number/.test(neg[0]), J(neg));
  const txt = remitMonthProblems({ 3: { remitDate: '2026-09-04', cereal: 'abc' } }, none, ctx);
  check('a Cereal figure that is not a number is refused', txt.length === 1 && /Cereal amount must be a number/.test(txt[0]), J(txt));
  const zero = remitMonthProblems({ 5: { nonCereal: 0, cereal: '' } }, none, ctx);
  check('0 and blank with no date: an empty day, not an error', zero.length === 0);
  // The live case (16_9_2026 day 1): a date with no amount, on a day whose
  // deposits come from its day sheet — the row is not even shown there.
  const hidden = remitMonthProblems({ 1: { remitDate: '2026-09-01' } }, new Set([1]), ctx);
  check('a day with deposits on its day sheet is not judged (they were checked when keyed)', hidden.length === 0);
  const ex = remitMonthProblems({ extra: { e1nc: 260, e2label: 'Inspection Charges', e2nc: 50, e2date: '2026-09-30', e3date: '2026-09-30' } }, none, ctx);
  check('extra rows: named by their label, same rule', ex.length === 2 && /^Poly & C\.Box Amount: Please select/.test(ex[0]) && /^Extra row 3: Please enter/.test(ex[1]), J(ex));
  const many = remitMonthProblems({ 2: { nonCereal: 10 }, 9: { remitDate: '2026-09-10' } }, none, ctx);
  check('every problem is listed, in date order', many.length === 2 && many[0].startsWith('02-09') && many[1].startsWith('09-09'), J(many));
}

console.log('\n2. The statement uses the saved remittance (existing flow)');
{
  const CRS = 8;
  const KEY = `${CRS}_9_2026`;
  const engine = (meRemitStore, entryStore = {}) =>
    createStatementEngine({
      stores: {
        entryStore, inspectionStore: {}, monthlyStore: { [KEY]: { a: {}, b: {} } },
        meManualStore: {}, meSourceStore: {}, meRemitStore, meGunnyStore: {}, meCardStore: {},
        salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
      },
      users: [], CRS_MASTER: [{ id: CRS, coll: false, police: false }],
      CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Shop ${i + 1}` })),
    });
  const saved = { [KEY]: { 27: { remitDate: '2026-09-28', nonCereal: 980 } } };
  const e = engine(saved);
  const d = e.getData(CRS, 9, 2026);
  check(`remitByDay[27] = ${J(d.remitByDay?.[27])}`, d.remitByDay?.[27]?.amount === 980 && d.remitByDay[27].remitDate === '2026-09-28' && d.remitByDay[27].src === 'monthly');
  const html = e.buildSection('remittance', d);
  const row = (html.match(/<tr>(?:(?!<\/tr>).)*27\/09\/2026(?:(?!<\/tr>).)*<\/tr>/s) ?? [''])[0];
  check('the Remittance statement prints it on 27/09/2026: date 28/09/2026, 980', /28\/09\/2026/.test(row) && />980</.test(row), row.replace(/\s+/g, ' ').slice(0, 200));
  const before = engine({}).buildSection('remittance', engine({}).getData(CRS, 9, 2026));
  check('…and without the row the statement has no 980', !/>980</.test(before));
  // A day sheet's deposit still wins its own date (Daily Entry is the primary source).
  const sheet = { [`${CRS}_2026-09-26`]: { a: {}, b: {}, remitAmount: 1670, remitDate: '2026-09-30', remits: [{ id: 'r1', amount: 1670, date: '2026-09-30', account: 'nc' }] } };
  const d2 = engine(saved, sheet).getData(CRS, 9, 2026);
  check('a day sheet\'s deposit keeps its own date: 26th = 1670 (daily), 27th = 980 (monthly)', d2.remitByDay[26]?.amount === 1670 && d2.remitByDay[26].src === 'daily' && d2.remitByDay[27]?.amount === 980, J([d2.remitByDay[26], d2.remitByDay[27]]));
}

console.log('\n3. Wiring');
{
  const table = readFileSync(join(root, 'src/app/(app)/monthly-entry/RemitTable.tsx'), 'utf8');
  const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');
  const save = table.slice(table.indexOf('const saveMonth = async'), table.indexOf('const th ='));
  check('the tick waits for the database (saveConfirmed before saveSuccess)', /if \(await crsData\.saveConfirmed\(\)\) \{\s*saveSuccess\(remittanceMonthSaved\(/.test(save));
  check('the rule runs before anything is sent', save.indexOf('remitMonthProblems') >= 0 && save.indexOf('remitMonthProblems') < save.indexOf('saveConfirmed'));
  check('a second tap while saving is ignored', /if \(busy\.current\) return;/.test(save));
  check('Save adds no record of its own (one per day, keyed by day)', !/crsData\.(update|set)\(/.test(save) && /m\[day\] = rec;/.test(table));
  check('hand-keyed rows are keyed by shop and month (no typed figure carried into another month)', /<tr key=\{`\$\{ctx\.key\}-\$\{day\}`\}/.test(table) && /<tr key=\{`\$\{ctx\.key\}-e\$\{n\}`\}/.test(table));
  check('amounts reach the store as typed (totals follow at once)', /onChange=\{\(e\) => writeDay\(day, 'nonCereal'/.test(table) && /onChange=\{\(e\) => writeExtra\(`e\$\{n\}nc`/.test(table));
  check('the admin ✎ / ✕ / ➕ still save on their own', /title="Correct this remittance/.test(table) && /title="Remove this remittance"/.test(table) && /title="Add another remittance for this sales date"/.test(table) && /saveSuccess\(remittanceSaved\(/.test(table));
  check('the button sits under the notes', table.indexOf('remit-save-bar') > table.indexOf('Leave Remittance Date empty'));
  check('hover shades body rows only (the TOTAL footer keeps its colour)', /:where\(tbody tr:hover td:not/.test(css) && !/:where\(tr:hover td:not/.test(css));
  const w = remittanceMonthSaved(8, 9, 2026);
  check(`wording: "${w.title}" / "${w.detail}"`, w.title === 'Remittance Saved Successfully' && w.detail === 'Remittance for September 2026 has been saved successfully.' && w.key === 'remit-month:8:9:2026');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll remittance-save checks passed.');
process.exitCode = failures ? 1 : 0;
