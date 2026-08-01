/**
 * Proves the assembled statement module (src/generated/statements-legacy.js)
 * reproduces the golden snapshots byte-for-byte.
 *
 *   node tools/dump-golden-stores.mjs        (refresh the data dump first)
 *   node tools/build-stmt-module.mjs
 *   node tools/verify-statements.mjs
 *
 * Renders every shop × section from public/golden-stores.json through the
 * module and diffs against golden/statements/<name>.html. Any byte diff is a
 * failure — these are statutory documents.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createStatementEngine } = await import('file://' + join(root, 'src', 'generated', 'statements-legacy.js'));

const dump = JSON.parse(readFileSync(join(root, 'public', 'golden-stores.json'), 'utf8'));
const stores = dump.stores;

// Same masters the golden harness fed the engine (via crsPersistWrite).
const shopsMaster = stores.__shops ?? [];
const CRS_LIST = shopsMaster.map((s, i) => ({ id: i + 1, name: s.name, code: s.code, taluk: s.taluk, district: s.district, cards: s.cards, active: s.active }));

const engine = createStatementEngine({
  stores: {
    entryStore: stores.entryStore ?? {},
    inspectionStore: stores.inspectionStore ?? {},
    monthlyStore: stores.monthlyStore ?? {},
    meManualStore: stores.meManualStore ?? {},
    meSourceStore: stores.meSourceStore ?? {},
    meRemitStore: stores.meRemitStore ?? {},
    meGunnyStore: stores.meGunnyStore ?? {},
    meCardStore: stores.meCardStore ?? {},
    salesCloseStore: stores.salesCloseStore ?? {},
    receiptStore: stores.receiptStore ?? [],
    meAllotStore: stores.meAllotStore ?? {},
    meCardConfirmed: stores.meCardConfirmed ?? {},
    meAdvanceStore: stores.meAdvanceStore ?? {},
  },
  users: dump.userStore ?? [],
  CRS_LIST,
  CRS_MASTER: stores.__crsMaster ?? [],
  TN_GOVT_HOLIDAYS: stores.__holidays ?? undefined,
  APP_CONFIG: stores.__config ?? {},
  CRS_ACCOUNTS: stores.__accounts ?? {},
  currentUser: null,
});

const SHOPS = [1, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 23, 24, 25, 26, 27, 28, 29, 30];
let pass = 0;
const fails = [];
for (const crs of SHOPS) {
  const ids = engine.sectionsFor(crs).map((s) => s.id);
  let d;
  try {
    d = engine.getData(crs, 6, 2026);
  } catch (e) {
    fails.push({ name: `crs${crs} getData`, err: e.stack?.split('\n').slice(0, 3).join(' | ') });
    continue;
  }
  for (const id of ids) {
    const name = `crs${crs}_${id}`;
    let html;
    try {
      html = engine.buildSection(id, d);
    } catch (e) {
      fails.push({ name, err: e.stack?.split('\n').slice(0, 3).join(' | ') });
      continue;
    }
    let golden;
    try {
      golden = readFileSync(join(root, 'golden', 'statements', `${name}.html`), 'utf8').replace(/\r\n/g, '\n');
    } catch {
      fails.push({ name, err: 'no golden file' });
      continue;
    }
    if (html === golden) {
      pass++;
    } else {
      let i = 0;
      while (i < Math.min(html.length, golden.length) && html[i] === golden[i]) i++;
      fails.push({
        name,
        err: `DIFF at offset ${i}: got ${JSON.stringify(html.slice(i, i + 60))} want ${JSON.stringify(golden.slice(i, i + 60))}`,
      });
    }
  }
}

console.log(`${pass} byte-identical, ${fails.length} failing`);
for (const f of fails.slice(0, 12)) console.log(`  FAIL ${f.name}: ${f.err}`);
if (fails.length > 12) console.log(`  … and ${fails.length - 12} more`);
process.exit(fails.length ? 1 : 0);
