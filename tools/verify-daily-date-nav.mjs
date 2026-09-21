/**
 * Daily Entry's ← Previous Date | Current Date | Next Date → (dateNav.ts).
 *
 *   node tools/verify-daily-date-nav.mjs
 *
 * The office's own example, then the calendar edges a hand-rolled date sum
 * gets wrong (month and year ends, leap years), and that Next stops at today
 * as the date box does. (office, 2026-09-21)
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { dateNav, shiftIso, dmy } = await import(pathToFileURL(join(root, 'src/app/(app)/daily-entry/dateNav.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const show = (n) => `← ${dmy(n.prev)} | ${dmy(n.current)} | ${dmy(n.next)} →`;

console.log('\nThe office\'s example — worked from the date on screen, not today');
{
  const today = '2026-09-30';
  let at = '2026-09-21';
  check('21-09-2026: ← 20-09-2026 | 21-09-2026 | 22-09-2026 →', show(dateNav(at, today)) === '← 20-09-2026 | 21-09-2026 | 22-09-2026 →', show(dateNav(at, today)));
  at = dateNav(at, today).next;
  check('Next → 22-09-2026: ← 21-09-2026 | 22-09-2026 | 23-09-2026 →', show(dateNav(at, today)) === '← 21-09-2026 | 22-09-2026 | 23-09-2026 →', show(dateNav(at, today)));
  at = dateNav(at, today).prev;
  check('Previous → 21-09-2026: ← 20-09-2026 | 21-09-2026 | 22-09-2026 →', show(dateNav(at, today)) === '← 20-09-2026 | 21-09-2026 | 22-09-2026 →', show(dateNav(at, today)));
  let walk = '2026-09-01';
  for (let i = 0; i < 10; i++) walk = dateNav(walk, today).next;
  check('ten Nexts from 01-09-2026 land on 11-09-2026', walk === '2026-09-11', walk);
  for (let i = 0; i < 10; i++) walk = dateNav(walk, today).prev;
  check('…and ten Previouses come back to 01-09-2026', walk === '2026-09-01', walk);
}

console.log('\nCalendar edges');
for (const [from, n, want] of [
  ['2026-09-30', 1, '2026-10-01'], ['2026-10-01', -1, '2026-09-30'],
  ['2026-12-31', 1, '2027-01-01'], ['2027-01-01', -1, '2026-12-31'],
  ['2026-02-28', 1, '2026-03-01'], ['2026-03-01', -1, '2026-02-28'],
  ['2028-02-28', 1, '2028-02-29'], ['2028-03-01', -1, '2028-02-29'],
  ['2026-03-29', 1, '2026-03-30'], ['2026-10-25', 1, '2026-10-26'],
]) check(`${dmy(from)} ${n > 0 ? '+' : '−'} 1 day = ${dmy(want)}`, shiftIso(from, n) === want, shiftIso(from, n));

console.log('\nNo day that has not happened');
{
  check('on today: Next is off', dateNav('2026-09-21', '2026-09-21').nextDisabled === true);
  check('the day before today: Next is on (it goes to today)', dateNav('2026-09-20', '2026-09-21').nextDisabled === false);
  check('Previous is never off', dateNav('2026-09-21', '2026-09-21').prev === '2026-09-20');
}

console.log(failures ? `\n${failures} FAILED` : '\nDAILY DATE NAV OK');
process.exit(failures ? 1 : 0);
