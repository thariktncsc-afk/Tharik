/**
 * The clear/delete guard's rules, as executable cases.
 *
 *   node tools/verify-clear-guard.mjs
 *
 * This is the check that matters for the approval workflow: the dialog and the
 * admin page are courtesy, but src/lib/clearGuard.ts is what actually decides
 * whether a shop can destroy statutory figures. Every rule below is one a real
 * save could hit.
 *
 * Runs the TypeScript source directly (Node >= 23.6 strips types).
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

const G = await import(pathToFileURL(join(root, 'src/lib/clearGuard.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const sheet = (sales) => ({ a: { BRA: { open: 100, receipt: 0, total: 100, sales, close: 100 - sales, amount: 0 } }, b: {} });
const empty = { a: { BRA: { open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0 } }, b: {} };
const KEY = '9_2026-06-05';
const one = (before, after, own = 9) => G.diffStore('entryStore', before, after, own);

console.log('what counts as destroying data');
check('deleting a key with figures is destructive', one({ [KEY]: sheet(40) }, {}).destructive.length === 1);
check('  …and is reported as removed', one({ [KEY]: sheet(40) }, {}).destructive[0].kind === 'removed');
check('blanking every figure is destructive', one({ [KEY]: sheet(40) }, { [KEY]: empty }).destructive[0]?.kind === 'emptied');
check('editing a figure is NOT destructive', one({ [KEY]: sheet(40) }, { [KEY]: sheet(30) }).destructive.length === 0);
check('an unchanged store is NOT destructive', one({ [KEY]: sheet(40) }, { [KEY]: sheet(40) }).destructive.length === 0);
check('adding a new day is NOT destructive', one({}, { [KEY]: sheet(40) }).destructive.length === 0);
check('deleting a key that never held figures is NOT destructive', one({ [KEY]: empty }, {}).destructive.length === 0);

console.log('generated sheets are the month\'s own output, not keyed data');
const projected = { ...sheet(40), __projection: { source: 'monthly', at: 'x' } };
check('removing a projected sheet needs no approval', one({ [KEY]: projected }, {}).destructive.length === 0);
check('a real sheet replacing a projection needs no approval', one({ [KEY]: projected }, { [KEY]: sheet(10) }).destructive.length === 0);
check('but removing the REAL sheet that replaced it does', one({ [KEY]: sheet(10) }, {}).destructive.length === 1);

// The month-close also writes the manual rows' adjustments onto the projection
// date, and removes them when a real day sheet takes over. Those are marked per
// commodity, not on the day, because a day can hold both kinds.
const ins = (rec) => G.diffStore('inspectionStore', { [KEY]: rec }, {}, 9);
const projAdj = { a: { BRA: { shortage: 5, __projection: true } }, b: {} };
const realAdj = { a: { BRA: { shortage: 5 } }, b: {} };
check('removing a fully projected inspection day needs no approval', ins(projAdj).destructive.length === 0);
check('removing a REAL inspection day does need approval', ins(realAdj).destructive.length === 1);
check('a day mixing real and projected adjustments still needs approval', ins({ a: { BRA: { shortage: 5, __projection: true }, SUGAR: { excess: 2 } }, b: {} }).destructive.length === 1);
check('an inspection day with no figures at all needs no approval', ins({ a: { BRA: { shortage: 0 } }, b: {} }).destructive.length === 0);

console.log('shop scoping');
const other = '10_2026-06-05';
check('changing another shop is foreign', one({ [other]: sheet(40) }, { [other]: sheet(30) }).foreign.length === 1);
check('carrying another shop UNCHANGED is fine', one({ [other]: sheet(40) }, { [other]: sheet(40) }).foreign.length === 0);
check('deleting another shop is foreign AND destructive', one({ [other]: sheet(40) }, {}).foreign.length === 1 && one({ [other]: sheet(40) }, {}).destructive.length === 1);
check('adding a row for another shop is foreign', one({}, { [other]: sheet(1) }).foreign.length === 1);
check('an admin (own=null) has no foreign records', one({ [other]: sheet(40) }, {}, null).foreign.length === 0);
check('CRS 1 does not match CRS 10 keys', G.crsOfKey('10_2026-06-05') === 10 && G.crsOfKey('1_2026-06-05') === 1);

console.log('receipts (an array, diffed by id)');
const rcp = (id, qty) => ({ id, crsId: 9, date: '2026-06-05', items: { SUGAR: { qty } } });
const rone = (b, a) => G.diffStore('receiptStore', b, a, 9);
check('deleting a receipt is destructive', rone([rcp('r1', 50)], []).destructive[0]?.kind === 'removed');
check('taking every commodity off a receipt is destructive', rone([rcp('r1', 50)], [{ ...rcp('r1', 0), items: {} }]).destructive[0]?.kind === 'emptied');
check('changing a quantity is NOT destructive', rone([rcp('r1', 50)], [rcp('r1', 40)]).destructive.length === 0);
check('adding a receipt is NOT destructive', rone([], [rcp('r2', 10)]).destructive.length === 0);

console.log('approvals');
const changes = one({ [KEY]: sheet(40) }, {}).destructive;
const grant = { id: 7, crsId: 9, keys: [KEY] };
check('an unapproved clear is blocked', G.unapproved(changes, []).length === 1);
check('an approved clear passes', G.unapproved(changes, [grant]).length === 0);
check('a grant for a DIFFERENT day does not cover this one', G.unapproved(changes, [{ id: 8, crsId: 9, keys: ['9_2026-06-06'] }]).length === 1);
check('a grant for a different SHOP does not cover this one', G.unapproved(changes, [{ id: 9, crsId: 10, keys: [KEY] }]).length === 1);
check('the grant used is reported so it can be spent', G.grantsUsed(changes, [grant]).join() === '7');
check('an unused grant is not spent', G.grantsUsed(changes, [{ id: 8, crsId: 9, keys: ['9_2026-06-06'] }]).length === 0);

console.log('whole-payload inspection');
const stored = { entryStore: { [KEY]: sheet(40) }, __config: { x: 1 }, meRemitStore: { '9_6_2026': { 5: { nonCereal: 100 } } } };
const wipe = { entryStore: {}, __config: {}, meRemitStore: {} };
const v = G.inspectWrite(stored, wipe, 9);
check('every protected store in one payload is inspected', v.destructive.length === 2, JSON.stringify(v.destructive.map((d) => d.store)));
check('unprotected stores (__config) are ignored', !v.destructive.some((d) => d.store === '__config'));
check('the modules are named for the admin', G.describe(v.destructive).includes('Daily Sales') && G.describe(v.destructive).includes('Remittance'));

console.log('hasData');
check('all-zero figures are no data', !G.hasData(empty));
check('a single non-zero figure is data', G.hasData(sheet(1)));
check('"0" as a string is no data', !G.hasData({ v: '0' }) && !G.hasData({ v: '' }));
check('markers alone are not data', !G.hasData({ __projection: { source: 'monthly' }, updatedAt: 'x', id: 'y' }));

console.log(failures === 0 ? '\nCLEAR GUARD OK' : `\n${failures} CLEAR GUARD FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
