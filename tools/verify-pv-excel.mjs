/**
 * The Excel round trip, and the consolidation rules.
 *
 *   node tools/verify-pv-excel.mjs
 *
 * Writes a month with the real writer, reads it back with the real reader, and
 * checks every figure survives. Then the rules that decide whether a PV adds
 * up: opening and closing are BALANCES and must not be summed, totals are
 * recomputed rather than trusted, and columns are found by heading name.
 *
 * The Excel library is the same CDN build the app loads at runtime; this
 * script fetches it once into a sandbox that mimics enough of a browser.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

// ── Get the same Excel library the browser uses ─────────────────────────────
const cacheDir = join(root, 'node_modules', '.cache');
const cached = join(cacheDir, 'xlsx-bundle.js');
if (!existsSync(cached)) {
  const res = await fetch('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js');
  if (!res.ok) {
    console.log(`  skip  could not download the Excel library (${res.status}); run again with a connection.`);
    process.exit(0);
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, await res.text());
}
const shim = { window: {}, document: { createElement: () => ({}), head: { appendChild() {} }, querySelector: () => null } };
globalThis.window = shim.window;
globalThis.document = shim.document;
globalThis.self = shim.window;
const { runInThisContext } = await import('node:vm');
runInThisContext(readFileSync(cached, 'utf8'));
const XLSX = globalThis.XLSX ?? shim.window.XLSX;
if (!XLSX) {
  console.log('  skip  the Excel library did not register a global.');
  process.exit(0);
}
shim.window.XLSX = XLSX;
globalThis.window.XLSX = XLSX;

const E = await import(pathToFileURL(join(root, 'src/lib/engine/pvExcel.ts')).href);

// A File the reader can consume, from a workbook in memory.
const asFile = (wb, name) => {
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name, arrayBuffer: async () => buf };
};

const month = (m, rows) => ({ crsId: 7, crsName: 'Test Shop', month: m, year: 2026, rows });
const row = (commId, open, receipt, sales, amount) => ({
  commId, name: commId, unit: 'KG', open, receipt, total: open + receipt, sales, closing: open + receipt - sales, amount,
});

console.log('round trip: what is written comes back');
const april = month(4, [row('BRA', 1000, 500, 400, 0), row('SUGAR', 200, 300, 250, 6250)]);
const back = await E.readMonthlyStatement(asFile(E.buildMonthlySheet(XLSX, april), 'April.xlsx'));
check('the CRS number survives', back.crsId === 7, String(back.crsId));
check('the month and year survive', back.month === 4 && back.year === 2026, `${back.month}/${back.year}`);
check('every commodity comes back', back.rows.length === 2);
const bra = back.rows.find((r) => r.commId === 'BRA');
check('opening / receipt / sales are exact', bra.open === 1000 && bra.receipt === 500 && bra.sales === 400, JSON.stringify(bra));
check('the amount survives', back.rows.find((r) => r.commId === 'SUGAR').amount === 6250);
check('total is recomputed from its parts', bra.total === 1500);
check('closing is recomputed, not copied', bra.closing === 1100);

console.log('a file that cannot be identified is refused, not guessed at');
const anon = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(anon, XLSX.utils.aoa_to_sheet([['Commodity', 'Opening', 'Receipt', 'Sales'], ['BRA', 1, 2, 3]]), 'S');
let msg = '';
try { await E.readMonthlyStatement(asFile(anon, 'mystery.xlsx')); } catch (e) { msg = e.message; }
check('a sheet with no CRS/month is refused', msg.includes('month and year') || msg.includes('CRS shop'), msg);
msg = '';
try { await E.readMonthlyStatement({ name: 'notes.txt', arrayBuffer: async () => new Uint8Array([1, 2, 3]) }); } catch (e) { msg = e.message; }
check('a non-spreadsheet is refused', msg.length > 0, msg);

console.log('columns are found by heading, never by position');
const shuffled = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(shuffled, XLSX.utils.aoa_to_sheet([
  ['CRS Number', 7], ['Month Number', 5], ['Year', 2026], [],
  ['Amount', 'Sales', 'Note', 'Commodity', 'Closing', 'Opening', 'Receipt'],
  [999, 400, 'ignored', 'BRA', 0, 1000, 500],
]), 'Odd');
const odd = await E.readMonthlyStatement(asFile(shuffled, 'odd.xlsx'));
check('a reordered sheet with an extra column reads correctly', odd.rows[0].open === 1000 && odd.rows[0].receipt === 500 && odd.rows[0].sales === 400, JSON.stringify(odd.rows[0]));
check('  …and its month came from the labelled row', odd.month === 5);

console.log('consolidation: balances are not summed');
const may = month(5, [row('BRA', 1100, 200, 300, 0)]);
const june = month(6, [row('BRA', 1000, 100, 600, 0)]);
const merged = E.consolidateMonths([april, may, june]);
const m = merged.find((r) => r.commId === 'BRA');
check('opening is the FIRST month\'s, not the sum', m.open === 1000, `got ${m.open} (sum would be 3100)`);
check('receipt is the sum of the three', m.receipt === 800, String(m.receipt));
check('sales is the sum of the three', m.sales === 1300, String(m.sales));
check('total = opening + receipt', m.total === 1800, String(m.total));
check('closing = total − sales, so the PV adds up', m.closing === 500, String(m.closing));
check('a commodity in only one month still appears', merged.find((r) => r.commId === 'SUGAR')?.sales === 250);

console.log(failures === 0 ? '\nPV EXCEL OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
