/**
 * Card Details & Allotment number boxes (office, 2026-09-28).
 *
 *   node tools/verify-card-inputs.mjs
 *
 * The recording: with the Sugar Card box focused and the pointer beside it,
 * the page was scrolled and the count stepped 0 ↔ 1 on its own — Chrome
 * changes a focused number input on the mouse WHEEL. The boxes also showed
 * the stored value reformatted on every key, so the caret jumped, and Enter
 * did nothing. monthly-entry/NumInput.tsx fixes the box; this holds the rules.
 *
 * The behaviour was driven in Chrome (desktop and a phone, a stand-in /api):
 * 0 → "1" is 1 and Total Card 914 → 915; 1 → 10 → 100 → 1000 key by key;
 * wheel turns leave the figure and scroll the page; ↑/↓ step by 1 (0.001 for
 * allotment); Enter goes down the column; 12.5 and 0.750 keep their digits;
 * both sections save and read back after a reload. The same wheel steps
 * against the OLD box moved Sugar Card 0 → 1 → 0 → 1.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const num = read('src/app/(app)/monthly-entry/NumInput.tsx');
const ca = read('src/app/(app)/monthly-entry/CardAllot.tsx');

console.log('\nThe box');
check('while focused it shows what was typed (draft), never the stored value reformatted', /value=\{draft \?\? value\}/.test(num) && /setDraft\(e\.target\.value\);\s*onValue\(e\.target\.value\)/.test(num));
check('…and every change still reaches the store at once (Total Card follows)', /onValue\(e\.target\.value\)/.test(num));
check('focusing selects the figure, so typing replaces the 0 instead of joining it', /onFocus=\{\(e\) => \{\s*setDraft\(value\);\s*e\.currentTarget\.select\(\);/.test(num));
check('the mouse wheel over the focused box scrolls the page and never steps the figure',
  /addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(num) && /if \(document\.activeElement !== el\) return;\s*e\.preventDefault\(\);\s*scroller\(el\)\?\.scrollBy/.test(num));
check('Enter moves to the next box DOWN the same column', /input\[data-num-col="\$\{column\}"\]/.test(num) && /all\[all\.indexOf\(e\.currentTarget\) \+ 1\]/.test(num));
check('↑ / ↓ and the spinner are the browser\'s own — still type="number" with the box\'s min and step', /type="number"/.test(num) && /min=\{min\}/.test(num) && /step=\{step\}/.test(num) && !/ArrowUp|ArrowDown/.test(num));
check('a phone gets the number pad and a Next key', /inputMode=\{step < 1 \? 'decimal' : 'numeric'\}/.test(num) && /enterKeyHint="next"/.test(num));

console.log('\nWhere it is used');
check('every Card Count, Allotment and Advance Load box uses it — no plain number input left',
  (ca.match(/<NumInput/g) ?? []).length === 3 && !/<input\s+type="number"/.test(ca));
check('each column is its own: card-count, allot-qty, advance-qty', ['card-count', 'allot-qty', 'advance-qty'].every((c) => ca.includes(`column="${c}"`)));
check('Card Count steps by 1 from 0; Allotment and Advance by 0.001 from 0 — as before',
  /column="card-count"\s*min=\{0\}\s*step=\{1\}/.test(ca) && /column="allot-qty"\s*min=\{0\}\s*step=\{0\.001\}/.test(ca) && /column="advance-qty"\s*min=\{0\}\s*step=\{0\.001\}/.test(ca));
check('the store rules are untouched: setCount / setAllot / setAdvance still parse and store',
  /onValue=\{\(raw\) => setCount\(ct\.id, raw\)\}/.test(ca) && /onValue=\{\(raw\) => setAllot\(c\.id, raw\)\}/.test(ca) && /onValue=\{\(raw\) => setAdvance\(c\.id, raw\)\}/.test(ca) &&
  /m\[id\] = \{ count: val === '' \? '' : parseInt\(val\) \|\| 0 \}/.test(ca));

console.log(failures ? `\n${failures} FAILED\n` : '\nCARD INPUTS OK\n');
process.exitCode = failures ? 1 : 0;
