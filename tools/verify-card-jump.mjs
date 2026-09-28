/**
 * Dashboard → Quick Actions → "Card Details & Allotment" → Monthly Entry,
 * scrolled to that section (office, 2026-09-28).
 *
 *   node tools/verify-card-jump.mjs
 *
 * The hand-off (monthly-entry/jump.ts) with a stand-in window and
 * sessionStorage, and the wiring read from the pages. The scroll itself was
 * checked in the browser (desktop and a 375px phone, as an administrator who
 * then chooses a shop): the section lands under the top bar and has focus.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

// A stand-in browser.
const store = new Map();
globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const loc = { pathname: '/monthly-entry', search: '', hash: '' };
globalThis.window = {
  location: loc,
  history: { state: { s: 1 }, replaceState: (_s, _t, url) => { const u = new URL(url, 'http://x'); loc.pathname = u.pathname; loc.search = u.search; loc.hash = u.hash; } },
};

const J = await import(pathToFileURL(join(root, 'src/app/(app)/monthly-entry/jump.ts')).href);

console.log('\n1. The hand-off');
check('the link is Monthly Entry at #card-details', J.CARD_DETAILS_HREF === '/monthly-entry#card-details');
check('nothing asked for: no jump', J.cardDetailsJumpWanted() === false);
J.requestCardDetailsJump();
check('the Dashboard\'s marker alone is enough — before the router puts #card-details in the address', J.cardDetailsJumpWanted() === true);
J.clearCardDetailsJump();
check('cleared after the jump: no second jump on a change of month', J.cardDetailsJumpWanted() === false);
loc.hash = '#card-details';
check('the address alone is enough too (a reload, a kept link)', J.cardDetailsJumpWanted() === true);
J.clearCardDetailsJump();
check('…and clearing takes #card-details off the address, keeping the path', loc.hash === '' && loc.pathname === '/monthly-entry');
globalThis.sessionStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
let threw = false;
try {
  J.requestCardDetailsJump();
  loc.hash = '#card-details';
  check('storage refused: still no error, and the address still carries it', J.cardDetailsJumpWanted() === true);
  J.clearCardDetailsJump();
} catch {
  threw = true;
}
check('…no exception anywhere', !threw);

console.log('\n2. The wiring');
const dash = readFileSync(join(root, 'src/app/(app)/dashboard/page.tsx'), 'utf8');
check('the Dashboard card: 🪪, the office\'s title and subtitle, the marker set before navigating',
  /quick\(CARD_DETAILS_HREF, '🪪', 'Card Details & Allotment', 'Manage monthly card details and allotment',[^\n]*requestCardDetailsJump\)\}/.test(dash) && /before\?\.\(\);\s*router\.push\(href\)/.test(dash));
check('…in the one Quick Actions grid, five across (a phone stacks them, responsive.css)', /gridTemplateColumns: 'repeat\(5,1fr\)'/.test(dash));
{
  // The office's order (2026-09-28), the same on every screen: the markup IS the order.
  const order = [...dash.matchAll(/\{quick\((?:'([^']+)'|(CARD_DETAILS_HREF))/g)].map((m) => m[1] ?? m[2]);
  const want = ['/daily-entry', '/receipt', 'CARD_DETAILS_HREF', '/monthly-entry', '/statements'];
  check('Quick Actions in the office\'s order: Daily Entry | Receipt | Card Details & Allotment | Monthly Entry | Statement',
    JSON.stringify(order) === JSON.stringify(want), JSON.stringify(order));
  check('…and nothing in the page re-orders them on a phone (no CSS order on the cards)', !/\.dash-quick[^{]*>\s*div[^{]*\{[^}]*order/.test(readFileSync(join(root, 'src/app/responsive.css'), 'utf8')));
}
const me = readFileSync(join(root, 'src/app/(app)/monthly-entry/page.tsx'), 'utf8');
check('Monthly Entry wraps the EXISTING CardAllot — no second Card Details page',
  /<div id=\{CARD_DETAILS_ID\} tabIndex=\{-1\}[^>]*>\s*<CardAllot /.test(me) && (me.match(/<CardAllot /g) ?? []).length === 1);
check('it scrolls only once the month has loaded and the section is on the page', /if \(dataStatus !== 'ready'\) return;/.test(me) && /document\.getElementById\(CARD_DETAILS_ID\)/.test(me));
check('an administrator without a shop is asked for one (the shop box focused)', /shopSelectRef\.current\?\.focus\(\)/.test(me) && /Choose a CRS shop for Card Details &amp; Allotment|Choose a CRS shop for Card Details & Allotment/.test(me));
check('CardAllot itself is untouched by this change', !/jump|CARD_DETAILS/.test(readFileSync(join(root, 'src/app/(app)/monthly-entry/CardAllot.tsx'), 'utf8')));

console.log(failures ? `\n${failures} FAILED\n` : '\nCARD JUMP OK\n');
process.exitCode = failures ? 1 : 0;
