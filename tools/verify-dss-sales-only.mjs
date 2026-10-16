/**
 * C.Box and Poly print the day's SALES only on the DSS (office, 2026-10-16).
 *
 *   node tools/verify-dss-sales-only.mjs
 *
 * Empty Card+Box and Empty Polythene Bag are not stocked on the sales grid:
 * their bags are kept in Gunny Stock Management. Their day-sheet Opening /
 * Closing went below 0 with every sale and every later day carried it on, so
 * the DSS printed CRS 1's one 22-box sale of 30-09 as -22.000 Opening, Total
 * and Closing on each October page. Daily / Monthly Entry show the two rows as
 * Sales only (SALES_ONLY); the DSS now does too (DSS_SALES_ONLY,
 * 17-dss-export.js).
 *
 * The real engine is driven through a stand-in document and Excel writer, so
 * the preview markup and the .xlsx cells are read as the shop sees them.
 * Nothing live, no database.
 */
import { readFileSync } from 'node:fs';
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
const J = JSON.stringify;

const CRS = 1, DATE = '2026-10-01', KEY = `${CRS}_${DATE}`;
const BOX = 'காலி அட்டைப்பெட்டி';   // காலி அட்டைப்பெட்டி
const BAG = 'காலி பாலிதீன் பை';                // காலி பாலிதீன் பை
const MASTER = [{ id: 'EMPTY_BOX', rate: 0.6 }, { id: 'EMPTY_BAG', rate: 2.5 }, { id: 'SUGAR', rate: 25 }, { id: 'PALM', rate: 25 }];

/** Renders one day: the preview row cells and the .xlsx cells of a row label. */
function day(a, insp = {}) {
  const html = [];
  const sheets = [];
  const engine = createDssEngine({
    stores: { entryStore: { [KEY]: { a, b: {} } }, inspectionStore: { [KEY]: insp } },
    CRS_LIST: [{ id: CRS, name: 'Test Shop' }],
    APP_CONFIG: { accountLabel: 'C A/C I', cerealAccountNo: '1' },
    CRS_ACCOUNTS: {},
    commodityMaster: MASTER,
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, remove() {}, appendChild() {} }),
      head: { appendChild() {} },
      body: { appendChild(n) { html.push(n.innerHTML || ''); } },
    },
    window: {
      XLSX: {
        utils: {
          encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
          book_new: () => ({ Sheets: {}, SheetNames: [] }),
          book_append_sheet: (wb, ws, n) => { wb.Sheets[n] = ws; wb.SheetNames.push(n); },
        },
        writeFile: (wb) => { for (const n of wb.SheetNames) sheets.push(wb.Sheets[n]); },
      },
    },
    alert: () => {},
  });
  engine.openPreview(CRS, DATE);
  engine.downloadExcel(CRS, DATE);
  const rows = [...html.join('\n').matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)]
    .map((m) => [...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
  const ws = sheets[0] ?? {};
  const xrow = (label) => {
    const r = Object.keys(ws).find((k) => /^C\d+$/.test(k) && ws[k].v === label);
    return r ? ['D', 'E', 'F', 'G', 'H', 'I', 'J'].map((c) => ws[c + r.slice(1)]?.v ?? '') : null;
  };
  const row = (label) => rows.find((r) => r[1] === label);
  const total = rows.filter((r) => r[1] === 'மொத்தம்')[0]?.[8];
  return { row, xrow, total, xTotal: ws.J35?.v };
}
/** Opening · Receipt · Total · Sales · Closing · Rate · Amount of a preview row. */
const fig = (r) => (r ? r.slice(2, 9) : null);

console.log('\n1. The office\'s cases');
{
  // A day with NO C.Box / Poly sale, its sheet carrying the -22 every later day carried on.
  const d = day({ EMPTY_BOX: { open: -22, receipt: 0, total: -22, sales: 0, close: -22 }, EMPTY_BAG: { open: -63, total: -63, close: -63 } });
  check(`no sale: C.Box prints ${J(fig(d.row(BOX)))}: nothing but its rate`, J(fig(d.row(BOX))) === J(['', '', '', '', '', '0.60', '']));
  check(`no sale: Poly prints ${J(fig(d.row(BAG)))}`, J(fig(d.row(BAG))) === J(['', '', '', '', '', '2.50', '']));
  check(`  …and the .xlsx the same (C.Box ${J(d.xrow(BOX))}, Poly ${J(d.xrow(BAG))})`, J(d.xrow(BOX)) === J(['', '', '', '', '', 0.6, '']) && J(d.xrow(BAG)) === J(['', '', '', '', '', 2.5, '']));
}
{
  // POLYTHENE Sales = 5 (2.50 each), C.BOX Sales = 3 (0.60 each), on sheets whose stock went below 0.
  const d = day({ EMPTY_BOX: { open: -22, sales: 3, close: -25 }, EMPTY_BAG: { open: 0, sales: 5, close: -5 } });
  check(`Poly Sales 5: ${J(fig(d.row(BAG)))}: exactly 5, amount 12.50`, J(fig(d.row(BAG))) === J(['', '', '', '5.000', '', '2.50', '12.50']));
  check(`C.Box Sales 3: ${J(fig(d.row(BOX)))}: exactly 3, amount 1.80`, J(fig(d.row(BOX))) === J(['', '', '', '3.000', '', '0.60', '1.80']));
  check(`  .xlsx: Poly ${J(d.xrow(BAG))}, C.Box ${J(d.xrow(BOX))}`, J(d.xrow(BAG)) === J(['', '', '', 5, '', 2.5, 12.5]) && J(d.xrow(BOX)) === J(['', '', '', 3, '', 0.6, 1.8]));
  check(`  the page's TOTAL money carries them: ${d.total} (12.50 + 1.80), .xlsx ${d.xTotal}`, d.total === '14.30' && d.xTotal === 14.3);
}
{
  // A valid Sales entry of zero: blank, like every 0 on the DSS, and no money.
  const d = day({ EMPTY_BOX: { open: -10, sales: 0, close: -10 }, EMPTY_BAG: { sales: '0' } });
  check(`a Sales entry of 0: C.Box ${J(fig(d.row(BOX)))}, Poly ${J(fig(d.row(BAG)))}`, J(fig(d.row(BOX))) === J(['', '', '', '', '', '0.60', '']) && J(fig(d.row(BAG))) === J(['', '', '', '', '', '2.50', '']) && d.total === '0.00');
}
{
  // A receipt on the sheet but no sale (none exist live): no stock figure, no artificial sale.
  const d = day({ EMPTY_BOX: { open: 0, receipt: 40, total: 40, sales: 0, close: 40 }, EMPTY_BAG: { open: -5, receipt: 10, total: 5, close: 5 } });
  check(`receipt, no sale: C.Box ${J(fig(d.row(BOX)))}, Poly ${J(fig(d.row(BAG)))}`, J(fig(d.row(BOX))) === J(['', '', '', '', '', '0.60', '']) && J(fig(d.row(BAG))) === J(['', '', '', '', '', '2.50', '']));
}
{
  // An inspection on the row (none exist live) moves no C.Box / Poly cell either.
  const d = day({ EMPTY_BOX: { open: 0, sales: 0 } }, { a: { EMPTY_BOX: { shortage: 4 } } });
  check(`inspection, no sale: C.Box ${J(fig(d.row(BOX)))}`, J(fig(d.row(BOX))) === J(['', '', '', '', '', '0.60', '']));
}
{
  // A negative Sales figure is never shown nor priced (none exist live).
  const d = day({ EMPTY_BOX: { open: 0, sales: -7, close: 7 }, EMPTY_BAG: { sales: 'abc' } });
  check(`a negative / unreadable Sales: C.Box ${J(fig(d.row(BOX)))}, Poly ${J(fig(d.row(BAG)))}, TOTAL ${d.total}`,
    J(fig(d.row(BOX))) === J(['', '', '', '', '', '0.60', '']) && J(fig(d.row(BAG))) === J(['', '', '', '', '', '2.50', '']) && d.total === '0.00');
}

console.log('\n2. Every other row prints as before');
{
  // Sugar keeps its five stock columns; Palm Oil's real negative stock (CRS 25, 06-10) is NOT hidden.
  const d = day({ SUGAR: { open: 500, receipt: 100, sales: 40 }, PALM: { open: 0, sales: 74 }, EMPTY_BOX: { open: -22, sales: 2 } });
  check(`Sugar: ${J(fig(d.row('சீனி')))}`, J(fig(d.row('சீனி'))) === J(['500.000', '100.000', '600.000', '40.000', '560.000', '25.00', '1000.00']));
  check(`Palm Oil's own negative Closing still prints: ${J(fig(d.row('பா.ஆயில்')))}`, J(fig(d.row('பா.ஆயில்'))) === J(['', '', '', '74.000', '-74.000', '25.00', '1850.00']));
  check(`TOTAL: 1000 + 1850 + C.Box 1.20 = ${d.total}`, d.total === '2851.20');
}

console.log('\n3. The source');
{
  const src = readFileSync(join(root, 'src/legacy/17-dss-export.js'), 'utf8');
  const ts = readFileSync(join(root, 'src/lib/engine/commodities.ts'), 'utf8');
  const dssList = J(/var DSS_SALES_ONLY = (\[[^\]]*\])/.exec(src)?.[1].replace(/'/g, '"') ? JSON.parse(/var DSS_SALES_ONLY = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"')).sort() : null);
  const appList = J(/SALES_ONLY = new Set\((\[[^\]]*\])\)/.exec(ts)?.[1] ? JSON.parse(/SALES_ONLY = new Set\((\[[^\]]*\])\)/.exec(ts)[1].replace(/'/g, '"')).sort() : null);
  check(`the DSS's list ${dssList} is the app's SALES_ONLY ${appList}`, dssList !== null && dssList === appList);
  check('both the preview (sectionRows) and the .xlsx (writeSection) apply it', (src.match(/dssSalesOnly\(c\.id\)/g) || []).length === 2);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL DSS SALES-ONLY CHECKS PASSED');
process.exit(failures ? 1 : 0);
