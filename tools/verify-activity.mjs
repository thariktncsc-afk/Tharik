/**
 * Activity derivation and, more importantly, its scoping.
 *
 *   node tools/verify-activity.mjs
 *
 * The rule that matters: a shop user must never be handed another shop's
 * movements. The last group checks that directly, including the case where a
 * write touched several shops at once.
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

const A = await import(pathToFileURL(join(root, 'src/lib/activity.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};

let id = 0;
const row = (store, version, by, data) => ({ id: ++id, store_key: store, version, updated_at: '2026-10-05T10:00:00Z', updated_by: by, data });
const sheet = (sales) => ({ a: { BRA: { open: 100, sales } }, b: {} });

console.log('a change is attributed to the shop whose key moved');
let items = A.deriveActivity([
  row('entryStore', 1, 'crs1', {}),
  row('entryStore', 2, 'crs1', { '1_2026-10-05': sheet(40) }),
]);
check('one entry produced', items.length === 1, JSON.stringify(items));
check('the actor is the username from the trail', items[0].actor === 'crs1');
check('the shop comes from the key', items[0].crsIds.join() === '1');
check('the module is named, not the store', items[0].module === 'Daily Sales', items[0].module);
check('it reads as added', items[0].added === 1 && items[0].updated === 0);

console.log('editing vs adding vs removing');
items = A.deriveActivity([
  row('entryStore', 1, 'crs1', { '1_2026-10-05': sheet(40) }),
  row('entryStore', 2, 'crs1', { '1_2026-10-05': sheet(50) }),
]);
check('an edit counts as updated, not added', items[0].updated === 1 && items[0].added === 0);
items = A.deriveActivity([
  row('entryStore', 1, 'crs1', { '1_2026-10-05': sheet(40) }),
  row('entryStore', 2, 'admin', {}),
]);
check('a deletion counts as removed', items[0].removed === 1);
check('  …and still names the shop', items[0].crsIds.join() === '1');
items = A.deriveActivity([
  row('entryStore', 1, 'crs1', { '1_2026-10-05': sheet(40) }),
  row('entryStore', 2, 'crs1', { '1_2026-10-05': sheet(40) }),
]);
// v1 is a real write (the sheet appeared); it is the SECOND, identical save
// that must add nothing.
check('a re-save with identical content adds no second entry', items.length === 1 && items[0].id === id - 1, JSON.stringify(items.map(i=>i.id)));

console.log('noise is kept off the panel');
check('meSourceStore is skipped (republished on every save)', A.deriveActivity([
  row('meSourceStore', 1, 'crs1', {}), row('meSourceStore', 2, 'crs1', { '1_10_2026': { a: {} } }),
]).length === 0);
check('masters are not activity', A.deriveActivity([
  row('__shops', 1, 'admin', []), row('__shops', 2, 'admin', [{ name: 'x' }]),
]).length === 0);

console.log('receipts carry their shop on the row, not in the id');
items = A.deriveActivity([
  row('receiptStore', 1, 'crs19', []),
  row('receiptStore', 2, 'crs19', [{ id: '7', crsId: 19, date: '2026-10-05', items: {} }]),
]);
check('the receipt row supplies the shop', items[0]?.crsIds.join() === '19', JSON.stringify(items[0]));
check('  …and the date', items[0]?.periods.join() === '2026-10-05');

console.log('SCOPING — a shop must not see another shop');
const many = A.deriveActivity([
  row('entryStore', 1, 'admin', {}),
  row('entryStore', 2, 'admin', { '1_2026-10-05': sheet(40), '9_2026-10-05': sheet(10) }),
]);
check('one write touching two shops is one entry', many.length === 1 && many[0].crsIds.join() === '1,9');
const asAdmin = A.scopeToShop(many, null);
check('an admin sees it with both shops', asAdmin.length === 1 && asAdmin[0].crsIds.join() === '1,9');
const asCrs1 = A.scopeToShop(many, 1);
check('CRS 1 sees the entry', asCrs1.length === 1);
check('  …but is NOT told CRS 9 was touched', asCrs1[0].crsIds.join() === '1', asCrs1[0].crsIds.join());
check('CRS 7, untouched, sees nothing', A.scopeToShop(many, 7).length === 0);
const unattributed = A.deriveActivity([row('entryStore', 5, 'admin', { '1_2026-10-05': sheet(1) })]);
check('an unattributable entry is withheld from a shop', A.scopeToShop(unattributed, 7).length === 0);

console.log('wording');
check('describes shop and date', A.describeActivity({ module: 'Daily Sales', crsIds: [1], periods: ['2026-10-05'], added: 1, updated: 0, removed: 0 }) === 'Daily Sales · CRS 1 · 05-10-2026 — added');
check('collapses many shops', A.describeActivity({ module: 'Receipt', crsIds: [1, 9], periods: [], added: 0, updated: 2, removed: 0 }).includes('2 shops'));

console.log(failures === 0 ? '\nACTIVITY OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
