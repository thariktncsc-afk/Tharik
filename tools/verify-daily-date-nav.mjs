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

// Office, 2026-09-28. The flow itself — Next / Previous / Current Date landing
// on the entry, and the saves below — was driven in Chrome (desktop and a
// phone) against the dev server with a stand-in /api; these hold the rules.
console.log('\nThe bar takes the clerk back up to the entry');
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const page = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src/app/(app)/daily-entry/page.tsx'), 'utf8');
  check('← Previous and Next → change the day AND scroll to the entry', /goToDate\(nav\.prev, \{ scroll: true \}\)/.test(page) && /goToDate\(nav\.next, \{ scroll: true \}\)/.test(page));
  check('…only once the new day is on screen (the scroll waits for `date` to be the one asked for)', /if \(!scrollTo \|\| scrollTo !== date\) return;/.test(page));
  check('Current Date is a button that ONLY scrolls — it never changes the day',
    /<button type="button" className="de-datenav-current"[^>]*onClick=\{scrollToEntry\}/.test(page));
  check('the target is the start of the commodity entry (#de-entry), not the top of the window',
    /id="de-entry" className="de-entry-top"/.test(page) && /getElementById\('de-entry'\)\?\.scrollIntoView/.test(page));
  check('the date box at the top does not scroll (only the bar asks for it)', /<DateField value=\{date\} max=\{todayIso\(\)\} onChange=\{\(v\) => void goToDate\(v\)\}/.test(page));

  console.log('\nRemittance: an administrator may save without one; shop staff may not');
  check('an empty deposit list stops shop staff, as before', /\} else if \(!list\.length && !isAdmin\) \{[\s\S]{0,400}?setRemitErr\(\{ amount: 'Please enter the Remittance Amount\.'/.test(page));
  check('…and lets an administrator through, with the sheet saved as `remits: []`', /snap\.remits = list;/.test(page));
  check('shop staff are still told a deposit is required; an administrator is told it can come later',
    /At least one deposit is required to complete the day\./.test(page) && /As an administrator you may save this day without one/.test(page));
}

console.log(failures ? `\n${failures} FAILED` : '\nDAILY DATE NAV OK');
process.exit(failures ? 1 : 0);
