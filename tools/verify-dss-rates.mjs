/**
 * The DSS prices a day's sales at the rate the office has SAVED, not the rate
 * that was compiled into the engine (office, 2026-09-26).
 *
 *   node tools/verify-dss-rates.mjs
 *
 * DSS_A / DSS_B are sliced out of 03-daily-entry.js by the module builder, so
 * every rate in them is frozen at whatever it was when that file was written.
 * CIS was moved to 10.00 on the Commodities screen on 2026-09-22 and the DSS
 * went on printing 12.00 — and charging the day's salt sales by it.
 *
 * The real engine is driven here through a stand-in document and Excel writer,
 * so the preview markup and the .xlsx cells are both read as the shop sees
 * them. Nothing live, no database.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createDssEngine } = await import(pathToFileURL(join(root, 'src/generated/dss-legacy.js')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const CRS = 7, DATE = '2026-09-16';
const KEY = `${CRS}_${DATE}`;
// 100 kg of CIS salt sold, and a sugar sale beside it to prove the rest is untouched.
const ENTRY = { [KEY]: { a: { SALT_CIS: { open: 200, receipt: 0, sales: 100 }, SUGAR: { open: 500, receipt: 0, sales: 40 } }, b: {} } };

/** Just enough DOM for openDSSViewer: it makes one div and appends it to the body. */
function fakeDoc(captured) {
  const el = () => ({
    id: '', style: { cssText: '' }, src: '', innerHTML: '',
    remove() {}, appendChild() {}, setAttribute() {}, classList: { add() {} },
  });
  return {
    getElementById: () => null,
    createElement: () => el(),
    head: { appendChild() {} },
    body: { appendChild(node) { captured.push(node.innerHTML || ''); } },
  };
}

/** Just enough of xlsx-js-style to catch what the export writes into each cell. */
function fakeXlsx(sheets) {
  return {
    utils: {
      encode_cell: ({ r, c }) => `${String.fromCharCode(65 + c)}${r + 1}`,
      book_new: () => ({ Sheets: {}, SheetNames: [] }),
      book_append_sheet: (wb, ws, name) => { wb.Sheets[name] = ws; wb.SheetNames.push(name); },
    },
    writeFile: (wb) => { for (const n of wb.SheetNames) sheets.push({ name: n, ws: wb.Sheets[n] }); },
  };
}

function run(commodityMaster) {
  const html = [];
  const sheets = [];
  const win = { XLSX: fakeXlsx(sheets), print() {}, alert() {} };
  const engine = createDssEngine({
    stores: { entryStore: ENTRY, inspectionStore: {} },
    CRS_LIST: [{ id: CRS, name: 'Test Shop', code: '22XX001PN' }],
    APP_CONFIG: {}, CRS_ACCOUNTS: {},
    commodityMaster,
    document: fakeDoc(html),
    window: win,
    alert: () => {},
  });
  engine.openPreview(CRS, DATE);
  engine.downloadExcel(CRS, DATE);
  return { html: html.join('\n'), sheets };
}

/** The row of the 16th's page for one commodity label, as printed. */
function rowCells(html, label) {
  const i = html.indexOf(label);
  if (i < 0) return null;
  const tr = html.lastIndexOf('<tr>', i);
  const end = html.indexOf('</tr>', i);
  return [...html.slice(tr, end).matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
}
const CIS = 'உப்பு (CIS)';   // உப்பு (CIS)
const SUGAR = 'சீனி';             // சீனி

console.log('\n1. The saved rate is the rate the DSS prints');
{
  const { html } = run([{ id: 'SALT_CIS', rate: 10 }, { id: 'SUGAR', rate: 25 }]);
  const cis = rowCells(html, CIS);
  check('CIS prints 10.00, not the compiled 12.00', cis && cis[7] === '10.00', JSON.stringify(cis));
  check('…and 100 kg sold is 1000.00, not 1200.00', cis && cis[8] === '1000.00', JSON.stringify(cis));
  const sug = rowCells(html, SUGAR);
  check('SUGAR is untouched: 25.00, 40 × 25 = 1000.00', sug && sug[7] === '25.00' && sug[8] === '1000.00', JSON.stringify(sug));
}

console.log('\n2. Every way the shop sees it');
{
  const { html, sheets } = run([{ id: 'SALT_CIS', rate: 10 }]);
  // The preview IS what Print and Save-as-PDF put on paper — the viewer prints
  // itself. SALT (RFFS) is 12.00 in its own right, so only the CIS row is read.
  check('the preview — and so Print and Save-as-PDF — carry 10.00 on the CIS line', rowCells(html, CIS)[7] === '10.00');
  check('SALT (RFFS), which really is 12.00, still prints 12.00',
    rowCells(html, 'உப்பு (RFFS)')[7] === '12.00', JSON.stringify(rowCells(html, 'உப்பு (RFFS)')));
  // The .xlsx: the rate column is I, on the row whose B cell is the CIS label.
  const day16 = sheets.find((s) => /16-09/.test(s.name)) ?? sheets[0];
  const cisRow = Object.entries(day16.ws).find(([a, v]) => a[0] === 'C' && v && v.v === CIS)?.[0].slice(1);
  check(`the Excel export writes 10 into the CIS rate cell I${cisRow} (${day16.name})`,
    !!cisRow && day16.ws['I' + cisRow]?.v === 10, JSON.stringify(cisRow ? day16.ws['I' + cisRow] : null));
  const rffsRow = Object.entries(day16.ws).find(([a, v]) => a[0] === 'C' && v && v.v === 'உப்பு (RFFS)')?.[0].slice(1);
  check('…and leaves RFFS at 12', !!rffsRow && day16.ws['I' + rffsRow]?.v === 12, JSON.stringify(rffsRow ? day16.ws['I' + rffsRow] : null));
}

console.log('\n3. It follows the master, it is not a second hard-coded 10');
{
  const { html } = run([{ id: 'SALT_CIS', rate: 14.5 }]);
  const cis = rowCells(html, CIS);
  check('the office moves CIS to 14.50 → the DSS prints 14.50 and 1450.00', cis && cis[7] === '14.50' && cis[8] === '1450.00', JSON.stringify(cis));
}

console.log('\n4. A master that says nothing changes nothing');
{
  const compiled = rowCells(run([]).html, CIS);
  check('no master at all: the engine keeps its own rate (12.00)', compiled && compiled[7] === '12.00', JSON.stringify(compiled));
  const partial = rowCells(run([{ id: 'SUGAR', rate: 25 }]).html, CIS);
  check('a master with no CIS row: CIS keeps the engine\'s rate', partial && partial[7] === '12.00', JSON.stringify(partial));
  const blank = rowCells(run([{ id: 'SALT_CIS', rate: '' }, { id: 'SALT_CIS' }]).html, CIS);
  check('a blank rate is not read as 0', blank && blank[7] === '12.00', JSON.stringify(blank));
  const junk = rowCells(run([{ id: 'SALT_CIS', rate: 'free' }]).html, CIS);
  check('a rate that is not a number is ignored', junk && junk[7] === '12.00', JSON.stringify(junk));
  const zero = rowCells(run([{ id: 'SALT_CIS', rate: 0 }]).html, CIS);
  check('a rate of 0 IS a rate: 0.00, and 100 kg comes to 0.00', zero && zero[7] === '0.00' && zero[8] === '0.00', JSON.stringify(zero));
}

console.log('\n5. Only the rate is taken from the master');
{
  // A free commodity stays free (no rate, no amount) even if the master
  // carries a figure for it, and a master row cannot add or reorder rows.
  const { html } = run([{ id: 'BRA', rate: 30, free: false }, { id: 'KERO', rate: 15.6 }]);
  const bra = rowCells(html, 'புழுங்கல் அரிசி');
  check('a free commodity is still free (விலையில்லா), not 30.00', bra && bra[7] === 'விலையில்லா', JSON.stringify(bra));
  check('a master row for a commodity the DSS has no line for adds nothing', !/KERO/.test(html));
  const rowsA = (run([]).html.match(/<td class="nm">/g) ?? []).length;
  const rowsB = (html.match(/<td class="nm">/g) ?? []).length;
  check('the page has exactly the same rows as before', rowsA === rowsB, `${rowsA} vs ${rowsB}`);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
