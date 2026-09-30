/**
 * Daily Entry asks before an administrator's Opening correction is saved
 * (office, 2026-09-30).
 *
 *   node tools/verify-opening-correction.mjs
 *
 * An Opening typed where a balance carries in is saved as a correction
 * (openFixed) that the month does not account for — CRS 5, 30-09-2026: Police
 * BRA carried 0, 12 typed, September closed 0 while October would open 12.
 * Checked: which rows ask (only a NEW correction that differs from the carry),
 * the wording, and that the save path asks before anything is built — for an
 * administrator only, with the calculation and permissions untouched.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const O = await import(pathToFileURL(join(root, 'src/app/(app)/daily-entry/openingCorrections.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const J = JSON.stringify;

console.log('1. Which Openings ask');
const pb = { label: 'BRA Rice (Police)', unit: 'KG' };
const crs5 = O.newOpeningCorrections([{ ...pb, carry: 0, open: 12, fixed: true, saved: null }]);
check(`CRS 5, 30-09: carried 0, typed 12 → asks (${J(crs5)})`, crs5.length === 1 && crs5[0].diff === 12);
check('an Opening left at the carry does not ask', O.newOpeningCorrections([{ ...pb, carry: 12, open: 12, fixed: false }]).length === 0);
check('typed back to exactly the carry does not ask', O.newOpeningCorrections([{ ...pb, carry: 12, open: 12.0001, fixed: true }]).length === 0);
check('the start of the chain (nothing carries in) does not ask — that is the Initial Opening', O.newOpeningCorrections([{ ...pb, carry: null, open: 12, fixed: true }]).length === 0);
check('a correction already saved at that figure does not ask again', O.newOpeningCorrections([{ ...pb, carry: 0, open: 12, fixed: true, saved: { open: 12, openFixed: true } }]).length === 0);
check('…but changing a saved correction does', O.newOpeningCorrections([{ ...pb, carry: 0, open: 15, fixed: true, saved: { open: 12, openFixed: true } }]).length === 1);
const two = O.newOpeningCorrections([
  { label: 'Sugar', unit: 'KG', carry: 680.624, open: 700, fixed: true },
  { label: 'Wheat', unit: 'KG', carry: 1615.002, open: 1615.002, fixed: false },
  { label: 'Palm Oil', unit: 'LTR', carry: 220, open: 210, fixed: true },
]);
check(`several at once, only those that differ: ${two.map((c) => `${c.label} ${c.diff}`).join(', ')}`, two.length === 2 && two[0].diff === 19.376 && two[1].diff === -10);

console.log('\n2. The wording');
const msg = O.openingCorrectionMessage(crs5, '30-09-2026');
console.log('        ' + msg.split('\n').join('\n        '));
check('names the day, the commodity, the carry, the typed figure and the difference', /30-09-2026/.test(msg) && /BRA Rice \(Police\): carried 0\.000, typed 12\.000 \(\+12\.000 KG\)/.test(msg) && /next month's Opening will not agree/.test(msg));

console.log('\n3. The save');
const page = readFileSync(join(root, 'src/app/(app)/daily-entry/page.tsx'), 'utf8').replace(/\r\n/g, '\n');
const save = page.slice(page.indexOf("title: 'Replace saved day sheet'"), page.indexOf('snap.remits = list;'));
check('asked only for an administrator, before the sheet is built', /if \(isAdmin\) \{\n\s+const corrections = newOpeningCorrections\(/.test(save) && save.indexOf('newOpeningCorrections(') < save.indexOf('const snap: SavedSheet'));
check('built from derive() — the same carry, Opening and fixed mark the save stores', /const d = derive\(sec, c\);\n\s+return \{ label: c\.en, unit: c\.unit, carry: d\.carry, open: d\.open, fixed: d\.openFixed, saved: saved\?\.\[sec\]\?\.\[c\.id\] \?\? null \};/.test(save));
check('Go back is the default and saves nothing', /cancelLabel: 'Go back',\n\s+defaultCancel: true,/.test(save) && /if \(!ok\) return false;\n\s+\}\n\s+\}\n\n\s+const snap: SavedSheet/.test(save));
check('the correction rule itself is unchanged', /openFixed = !!r\.fixed && \(auto === null \|\| !near3\(open, auto\)\);/.test(page));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll opening-correction checks passed.');
process.exitCode = failures ? 1 : 0;
