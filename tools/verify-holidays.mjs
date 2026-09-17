/**
 * The holiday engine (src/lib/engine/holidays.ts), date by date.
 *
 *   node tools/verify-holidays.mjs
 *
 * Regular holidays are ONLY the 1st & 2nd Fridays and the 3rd & 4th Sundays of
 * a month; government holidays are ONLY their exact configured dates;
 * everything else is a working day. The Dashboard status, its working-day
 * counts, Daily Entry's date line and the calendar all ask this one engine.
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
const H = await import(pathToFileURL(join(root, 'src/lib/engine/holidays.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const on = (iso) => new Date(`${iso}T00:00:00`);
// A government calendar as the __holidays master stores it.
const GOVT = { 2026: [{ d: '2026-09-14', name: 'Test Government Holiday' }, { d: '2026-10-02', name: 'Gandhi Jayanthi' }] };
const status = (iso, cal = GOVT) => H.holidayOn(on(iso), cal);

console.log('\nSeptember 2026 (starts on a Tuesday)');
const cases = [
  ['2026-09-16', null, 'Wednesday — a normal working day'],
  ['2026-09-04', 'Today is a Friday Holiday', '1st Friday'],
  ['2026-09-11', 'Today is a Friday Holiday', '2nd Friday'],
  ['2026-09-18', null, '3rd Friday — working'],
  ['2026-09-25', null, '4th Friday — working'],
  ['2026-09-06', null, '1st Sunday — working'],
  ['2026-09-13', null, '2nd Sunday — working (the old formula called it the 3rd)'],
  ['2026-09-20', 'Today is a Sunday Holiday', '3rd Sunday'],
  ['2026-09-27', 'Today is a Sunday Holiday', '4th Sunday (the old formula missed it)'],
  ['2026-09-14', 'Today is Test Government Holiday', 'a configured Government Holiday (a Monday)'],
  ['2026-09-15', null, 'the day after the Government Holiday — expired'],
  ['2026-09-17', null, '17 Sep — nothing configured in this test calendar, a Thursday'],
];
for (const [iso, headline, label] of cases) {
  const s = status(iso);
  check(`${iso} ${label} → ${headline ?? 'Working Day'}`, (s?.headline ?? null) === headline, JSON.stringify(s));
}
check('the 1st Friday is named "1st Friday Holiday"', status('2026-09-04').name === '1st Friday Holiday');
check('the 4th Sunday is named "4th Sunday Holiday"', status('2026-09-27').name === '4th Sunday Holiday');

console.log('\nA month that starts on a Saturday — August 2026');
check('7 Aug is the 1st Friday → holiday', status('2026-08-07')?.kind === 'friday');
check('14 Aug is the 2nd Friday → holiday', status('2026-08-14')?.kind === 'friday');
check('21 Aug is the 3rd Friday → working', status('2026-08-21') === null);
check('16 Aug is the 3rd Sunday → holiday', status('2026-08-16')?.kind === 'sunday');
check('23 Aug is the 4th Sunday → holiday', status('2026-08-23')?.kind === 'sunday');
check('30 Aug is the 5th Sunday → working', status('2026-08-30') === null);

console.log('\nPriority and matching');
{
  const cal = { 2026: [{ d: '2026-09-04', name: 'Special Day' }] };
  check('a Government Holiday on a regular holiday is shown by its own name', status('2026-09-04', cal).headline === 'Today is Special Day');
  check('no calendar loaded: only the weekly rule applies', H.holidayOn(on('2026-09-14'), undefined) === null && H.holidayOn(on('2026-09-20'), undefined)?.kind === 'sunday');
  check('a holiday of another year does not match', H.holidayOn(on('2027-09-14'), GOVT)?.kind !== 'govt');
  check('asking again for a later date never returns the earlier answer', status('2026-09-14').kind === 'govt' && status('2026-09-15') === null && status('2026-09-14').kind === 'govt');
}

console.log('\nWorking-day counts — the Dashboard KPIs');
{
  // Sheets on 1–3, 5, 7–10, 12, 15, 16 September; today is the 17th.
  const have = new Set(['01', '02', '03', '05', '07', '08', '09', '10', '12', '15', '16'].map((d) => `2026-09-${d}`));
  const c = H.workingDayCounts((ds) => have.has(ds), 2026, 9, 17, GOVT);
  // 1–17 Sep: holidays are 4 & 11 (Fridays) and 14 (government) → 14 working days.
  check('3 holidays up to 17 Sep (4th, 11th, 14th)', c.holidays === 3, JSON.stringify(c));
  check('11 entries this month', c.withEntry === 11, JSON.stringify(c));
  check('3 days without entry (6th, 13th, 17th) — the Government Holiday is not one', c.withoutEntry === 3, JSON.stringify(c));
  const wkOnly = H.workingDayCounts((ds) => have.has(ds), 2026, 9, 17, undefined);
  check('without the Government Holiday configured the 14th would be a missed day', wkOnly.withoutEntry === 4, JSON.stringify(wkOnly));
  const whole = H.workingDayCounts(() => false, 2026, 9, 30, GOVT);
  check('all of September: 5 holidays (4, 11, 14, 20, 27), 25 working days', whole.holidays === 5 && whole.withoutEntry === 25, JSON.stringify(whole));
}

console.log(failures ? `\n${failures} FAILED` : '\nHOLIDAYS OK');
process.exitCode = failures ? 1 : 0;
