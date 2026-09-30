/**
 * Dates on screen are DD-MM-YYYY (office, 2026-09-29).
 *
 *   node tools/verify-date-format.mjs
 *
 * The office's phone (Chrome, US English) showed Daily Entry's date as
 * 09/29/2026: a native <input type="date"> is drawn in the BROWSER's language
 * and no page setting changes it. Every date box is now DateField (our own
 * DD-MM-YYYY text over the native picker), and the screens' hand-made
 * DD/MM/YYYY texts are DD-MM-YYYY. Stored dates stay ISO. Checked here:
 *   1. the formatting and parsing rules — day first, always;
 *   2. no native date input left outside DateField, no hand-made slash dates
 *      on the screens, and DateField hands back the ISO value untouched;
 *   3. what stays as it was: stored timestamps, and the printed statements.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(pathToFileURL(join(root, 'src/lib/dateFormat.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

console.log('1. The rules');
check('2026-09-29 → 29-09-2026', D.dmy('2026-09-29') === '29-09-2026');
check('2026-10-01 → 01-10-2026, and blank stays blank', D.dmy('2026-10-01') === '01-10-2026' && D.dmy('') === '');
check('typed 29-09-2026 → 2026-09-29', D.parseDmy('29-09-2026') === '2026-09-29');
check('typed 29/09/2026, 29.09.2026 and 29092026 read the same', ['29/09/2026', '29.09.2026', '29092026'].every((t) => D.parseDmy(t) === '2026-09-29'));
check('DAY FIRST: 09-12-2026 is 9 December, never 12 September', D.parseDmy('09-12-2026') === '2026-12-09');
check('the American 09/29/2026 is not a date (there is no month 29) — never read as 29 September by guessing', D.parseDmy('09/29/2026') === null);
check('31-02-2026, 29-02-2026 and 00-09-2026 are not dates; 29-02-2028 is', D.parseDmy('31-02-2026') === null && D.parseDmy('29-02-2026') === null && D.parseDmy('00-09-2026') === null && D.parseDmy('29-02-2028') === '2028-02-29');
check('typing is masked as it goes: 2 → "2", 2909 → "29-09", 29092026 → "29-09-2026", extra digits dropped', D.maskDmy('2') === '2' && D.maskDmy('2909') === '29-09' && D.maskDmy('29092026') === '29-09-2026' && D.maskDmy('290920261') === '29-09-2026' && D.maskDmy('29-09-2026') === '29-09-2026');
check('a moment: 29-09-2026, 04:46 pm', D.dmyTime(new Date(2026, 8, 29, 16, 46)) === '29-09-2026, 04:46 pm' && D.dmyTime(new Date(2026, 8, 29, 0, 5)) === '29-09-2026, 12:05 am');
check('a stored receipt time "29/9/2026, 4:46:00 pm" is SHOWN as 29-09-2026, 04:46 pm', D.dmyFromLocale('29/9/2026, 4:46:00 pm') === '29-09-2026, 04:46 pm');
check('…and anything else stored is shown as it is', D.dmyFromLocale('yesterday') === 'yesterday' && D.dmyFromLocale('') === '');

console.log('\n2. The screens');
const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'generated' && n !== 'legacy') walk(p); }
    else if (/\.(tsx?|jsx?)$/.test(n)) files.push(p);
  }
})(join(root, 'src'));
const src = (p) => readFileSync(p, 'utf8');
const nativeDate = files.filter((p) => !p.endsWith('DateField.tsx') && /type=["']date["']/.test(src(p))).map((p) => relative(root, p));
check(`no native date input outside DateField (${nativeDate.join(', ') || 'none'})`, nativeDate.length === 0);
const users = files.filter((p) => /<DateField\b/.test(src(p))).map((p) => relative(root, p));
check(`DateField is what every screen with a date box uses: ${users.length} screens`, users.length >= 7, users.join(', '));
const slash = files.filter((p) => /reverse\(\)\.join\(['"]\/['"]\)/.test(src(p))).map((p) => relative(root, p));
check(`no hand-made DD/MM/YYYY left on the screens (${slash.join(', ') || 'none'})`, slash.length === 0);
const bareLocale = files.flatMap((p) => src(p).split('\n').map((l, i) => ({ p: relative(root, p), i: i + 1, l }))).filter(({ l }) => /Date\([^)]*\)\.toLocale(Date)?String\('en-IN'\)/.test(l) && !/savedAt:/.test(l));
check(`no bare toLocaleString('en-IN') shown as a date (d/m/yyyy with slashes): ${bareLocale.map((x) => `${x.p}:${x.i}`).join(', ') || 'none'}`, bareLocale.length === 0);
const field = src(join(root, 'src/components/DateField.tsx'));
check('DateField hands back the ISO value itself: from the calendar (e.target.value) and from typing (parseDmy → ISO)', /onChange=\{\(e\) => \{\n\s+const iso = e\.target\.value;/.test(field) && /const iso = next\.length === 10 \? parseDmy\(next\) : null;/.test(field));
check('…and holds min / max for typing as the calendar does', /if \(iso && inRange\(iso\) && iso !== value\) onChange\(iso\);/.test(field) && /min=\{min\}\s*\n\s*max=\{max\}/.test(field));
check('on a touch screen the native input lies over the box, so a tap opens the phone\'s calendar', /className=\{coarse \? 'date-field-native is-touch' : 'date-field-native'\}/.test(field) && /\.date-field-native\.is-touch\{top:0;left:0;right:0;bottom:0;width:100%!important;height:100%;pointer-events:auto/.test(src(join(root, 'src/app/globals.css'))));

console.log('\n3. What stays as it was');
const receipt = src(join(root, 'src/app/(app)/receipt/page.tsx'));
check('a receipt still STORES savedAt exactly as before (only its display changed)', /savedAt: new Date\(\)\.toLocaleString\('en-IN'\),/.test(receipt) && /\{dmyFromLocale\(r\.savedAt\)\}/.test(receipt));
const builders = readFileSync(join(root, 'src/legacy/12-statement-builders.js'), 'utf8');
check('the printed statements keep their own statutory dd/mm/yyyy (builders untouched)', /function fmtDate\(s\)\{ if\(!s\) return ''; var p=String\(s\)\.split\('-'\); return p\.length===3\?\(p\[2\]\+'\/'\+p\[1\]\+'\/'\+p\[0\]\):s; \}/.test(builders));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll date-format checks passed.');
process.exitCode = failures ? 1 : 0;
