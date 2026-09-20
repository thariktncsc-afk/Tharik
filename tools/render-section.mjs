/**
 * Render one statement section for every shop, to a folder.
 *
 *   node tools/render-section.mjs <sectionId> <outDir>
 *
 * Same engine and same data dump `verify:statements` uses, so a render taken
 * before a builder change and one taken after are directly comparable — which
 * is how an intended change to a statutory format is shown to be exactly the
 * change intended, and nothing else.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sectionId = process.argv[2] ?? 'receipt';
const outDir = process.argv[3] ?? join(root, 'tmp-render', sectionId);

const { createStatementEngine } = await import('file://' + join(root, 'src', 'generated', 'statements-legacy.js'));
const dump = JSON.parse(readFileSync(join(root, 'public', 'golden-stores.json'), 'utf8'));
const stores = dump.stores;

const shopsTs = readFileSync(join(root, 'src', 'lib', 'engine', 'shops.ts'), 'utf8');
const CRS_NAMES = {};
for (const m of shopsTs.matchAll(/^\s*(\d+):\s*'([^']+)',\s*$/gm)) CRS_NAMES[Number(m[1])] = m[2];
const shopExtras = stores.__shops ?? [];
const CRS_LIST = Array.from({ length: 30 }, (_, i) => ({ ...(shopExtras[i] ?? {}), id: i + 1, name: CRS_NAMES[i + 1] }));

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

mkdirSync(outDir, { recursive: true });
let written = 0;
for (const crsId of SHOPS) {
  const d = engine.getData(crsId, 6, 2026);
  const html = engine.buildSection(sectionId, d);
  if (!html) continue;
  writeFileSync(join(outDir, `crs${crsId}_${sectionId}.html`), html);
  written++;
}
console.log(`${written} × ${sectionId} → ${outDir}`);
