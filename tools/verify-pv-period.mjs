/**
 * PV period rules — the statutory cycle, and what may be consolidated.
 *
 *   node tools/verify-pv-period.mjs
 *
 * The first group is the bug this replaced: quarters were rolling three-month
 * windows stepped back from today, so from September the screen offered
 * "Sep-Nov" — a period no PV covers, whose opening and closing came from the
 * wrong months.
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

const P = await import(pathToFileURL(join(root, 'src/lib/engine/pvPeriod.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const ms = (p) => p.months.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`).join(',');

console.log('quarters snap to the financial year, whatever month is picked');
check('April  → Apr-Jun', ms(P.quarterFor({ year: 2026, month: 4 })) === '2026-04,2026-05,2026-06');
check('June   → Apr-Jun', ms(P.quarterFor({ year: 2026, month: 6 })) === '2026-04,2026-05,2026-06');
check('September → Jul-Sep (NOT Sep-Nov)', ms(P.quarterFor({ year: 2026, month: 9 })) === '2026-07,2026-08,2026-09');
check('December  → Oct-Dec', ms(P.quarterFor({ year: 2026, month: 12 })) === '2026-10,2026-11,2026-12');
check('February  → Jan-Mar of the SAME calendar year', ms(P.quarterFor({ year: 2027, month: 2 })) === '2027-01,2027-02,2027-03');
check('the PV month is the quarter\'s last month', P.quarterFor({ year: 2026, month: 7 }).pvMonth.month === 9);

console.log('financial years run April to March');
check('June 2026 is in FY 2026', P.fyOf({ year: 2026, month: 6 }) === 2026);
check('March 2027 is still FY 2026', P.fyOf({ year: 2027, month: 3 }) === 2026);
check('April 2027 starts FY 2027', P.fyOf({ year: 2027, month: 4 }) === 2027);
check('Jan-Mar belongs to the PREVIOUS year\'s FY', P.quarterFor({ year: 2027, month: 2 }).fy === 2026);
const yr = P.annualFor(2026);
check('an annual PV is 12 months, Apr 2026 first', yr.months.length === 12 && ms(yr).startsWith('2026-04'));
check('  …and Mar 2027 last', yr.months[11].year === 2027 && yr.months[11].month === 3);
check('labelled 2026-27', yr.fyLabel === '2026-27', yr.fyLabel);
check('range reads 1.04.2026 TO 31.03.2027', yr.rangeLabel === '1.04.2026 TO 31.03.2027', yr.rangeLabel);
check('quarter range ends on the real last day (30 June)', P.quarterFor({ year: 2026, month: 6 }).rangeLabel === '1.04.2026 TO 30.06.2026');
// No PV quarter ends in February — picking it lands in Jan-Mar, which ends on
// 31 March. Leap years therefore never reach the range label at all.
check('February lands in Jan-Mar, ending 31 March', P.quarterFor({ year: 2028, month: 2 }).rangeLabel === '1.01.2028 TO 31.03.2028', P.quarterFor({ year: 2028, month: 2 }).rangeLabel);

console.log('the four PV filing months, and history');
const opts = P.quarterOptions(new Date(2026, 8, 8), 8); // 8 Sept 2026
check('the newest option is the quarter containing today', ms(opts[0]) === '2026-07,2026-08,2026-09');
check('every option ends in Jun/Sep/Dec/Mar', opts.every((o) => [3, 6, 9, 12].includes(o.pvMonth.month)));
check('options step back one quarter at a time', ms(opts[1]) === '2026-04,2026-05,2026-06' && ms(opts[2]) === '2026-01,2026-02,2026-03');
check('history does not depend on today', ms(P.quarterFor({ year: 2024, month: 5 })) === '2024-04,2024-05,2024-06');

console.log('what may be consolidated');
const S = (crsId, year, month) => ({ crsId, year, month });
const q = (list) => P.validateSources(list, 'quarter');

check('three consecutive months of one shop pass', q([S(7, 2026, 4), S(7, 2026, 5), S(7, 2026, 6)]).ok);
check('files added out of order are sorted', q([S(7, 2026, 6), S(7, 2026, 4), S(7, 2026, 5)]).ordered.map((s) => s.month).join() === '4,5,6');
const mixed = q([S(1, 2026, 4), S(1, 2026, 5), S(7, 2026, 6)]);
check('two shops are refused', !mixed.ok && mixed.errors[0].includes('CRS Shop mismatch'));
const dup = q([S(7, 2026, 4), S(7, 2026, 4), S(7, 2026, 5)]);
check('a duplicate month is refused', !dup.ok && dup.errors.some((e) => e.includes('twice')));
const stray = q([S(7, 2026, 5), S(7, 2026, 6), S(7, 2026, 7)]);
check('a set straddling two quarters is refused', !stray.ok && stray.errors.some((e) => e.includes('outside')));
const short = q([S(7, 2026, 4), S(7, 2026, 5)]);
check('a missing month is named', !short.ok && short.errors.some((e) => e.includes('June 2026')));
check('  …and reported for the UI', short.missing.length === 1 && short.missing[0].month === 6);
check('nothing uploaded is refused', !q([]).ok);

const year12 = P.annualMonths(2026).map((m) => S(3, m.year, m.month));
check('all twelve monthly statements make an annual PV', P.validateSources(year12, 'annual').ok);
check('eleven do not', !P.validateSources(year12.slice(0, 11), 'annual').ok);
check('an annual set spanning the wrong FY is refused', !P.validateSources([...year12.slice(1), S(3, 2027, 4)], 'annual').ok);

console.log('availability follows the data, not the calendar');
const store = {};
for (const m of P.quarterMonths(2026, 0)) store[`7_${m.month}_${m.year}`] = {};
const avail = P.availablePeriods(store, 7, new Date(2026, 8, 8));
check('Apr-Jun is offered once all three months are published', avail.quarters.some((p) => ms(p) === '2026-04,2026-05,2026-06'));
check('Jul-Sep is not, with no data', !avail.quarters.some((p) => ms(p) === '2026-07,2026-08,2026-09'));
check('another shop sees nothing from these months', P.availablePeriods(store, 8, new Date(2026, 8, 8)).quarters.length === 0);

console.log(failures === 0 ? '\nPV PERIOD OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
