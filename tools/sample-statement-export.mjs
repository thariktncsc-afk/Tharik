/**
 * Build sample exports from the golden statements, to look at.
 *
 *   node tools/sample-statement-export.mjs [crs19] [outDir]
 *
 * Reads `golden/statements/crs<N>_*.html` — the snapshots of what the builders
 * produce, so no live data and no database — and writes the two files the
 * Statements screen would download: the print document (open it and use the
 * browser's Print → Save as PDF) and the .xlsx.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
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

const P = await import(pathToFileURL(join(root, 'src/lib/statements/printDoc.ts')).href);
const W = await import(pathToFileURL(join(root, 'src/lib/statements/toWorkbook.ts')).href);

const shop = process.argv[2] ?? 'crs19';
const outDir = process.argv[3] ?? join(root, 'tmp-export');
const GOLDEN = join(root, 'golden/statements');

// The order the Statements screen lists them in, as far as the file names say.
const ORDER = ['crs_page1', 'receipt', 'crs_daily_sale', 'crs_page2', 'gunny', 'free_com', 'cost_com', 'remittance', 'sale_tax', 'coll', 'crs_police', 'b6', 'card_details', 'rbi'];
const TWO_COPIES = new Set(['crs_page2', 'gunny']);

const files = readdirSync(GOLDEN).filter((f) => f.startsWith(`${shop}_`) && f.endsWith('.html'));
const idOf = (f) => f.replace(`${shop}_`, '').replace('.html', '');
files.sort((a, b) => ORDER.indexOf(idOf(a)) - ORDER.indexOf(idOf(b)));

const label = (id) => id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const sections = files.map((f) => ({
  id: idOf(f),
  label: label(idOf(f)),
  copies: TWO_COPIES.has(idOf(f)) ? 2 : 1,
  html: readFileSync(join(GOLDEN, f), 'utf8'),
}));

mkdirSync(outDir, { recursive: true });
const title = `TNCSC Statements - ${shop.toUpperCase()} (sample from golden snapshots)`;
const htmlPath = join(outDir, `${shop}-statements-print.html`);
const xlsxPath = join(outDir, `${shop}-statements.xlsx`);
writeFileSync(htmlPath, P.buildPrintDocument(title, '', sections));
writeFileSync(xlsxPath, W.buildStatementsXlsx(sections.map((s) => ({ id: s.id, label: s.label, html: s.html }))));

console.log(`${sections.length} statements → ${P.sheetCount(sections)} printed sheets`);
for (const s of sections) {
  console.log(`  ${s.label.padEnd(16)} ${P.orientationOf(s.html).padEnd(9)} ${P.columnCount(s.html)} cols${s.copies > 1 ? `  ×${s.copies}` : ''}`);
}
console.log(`\nprint document: ${htmlPath}\nworkbook:       ${xlsxPath}`);
