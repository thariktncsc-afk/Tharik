/**
 * The DSS TOTAL row carries the money alone, and the account line at the foot
 * states what was actually BANKED (office, 2026-09-26).
 *
 *   node tools/verify-dss-totals.mjs
 *
 * Two things were wrong on every page. The TOTAL row added the kilo columns
 * down the page — opening + receipt + total + sales + closing — figures the
 * form does not ask for. And the account line worked its amount out from the
 * day's sales instead of reading the deposit: CRS 8's 21-09-2026 page said
 * 4639.50 where the shop had banked 4640.
 *
 * The real engine is driven here through a stand-in document and Excel
 * writer, so the preview markup and the .xlsx cells are read as the shop sees
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

const CRS = 8, DATE = '2026-09-21', KEY = `${CRS}_${DATE}`;
const TOTAL_LABEL = 'மொத்தம்';   // மொத்தம்
const RUPEE = 'ரூபாய்';               // ரூபாய்
const CIS = 'உப்பு (CIS)';

/** Sugar 100 kg at 25 and CIS 40 at 10: 2500 + 400 = 2900.00 of sales. */
const sheet = (extra) => ({
  a: { SUGAR: { open: 500, receipt: 0, sales: 100 }, SALT_CIS: { open: 200, receipt: 0, sales: 40 } },
  b: { PB_SUGAR: { open: 10, receipt: 0, sales: 2 } },
  ...extra,
});
const MASTER = [{ id: 'SALT_CIS', rate: 10 }, { id: 'SUGAR', rate: 25 }, { id: 'PB_SUGAR', rate: 12.5 }];

function run(sheetExtra) {
  const html = [];
  const sheets = [];
  const engine = createDssEngine({
    stores: { entryStore: { [KEY]: sheet(sheetExtra) }, inspectionStore: {} },
    CRS_LIST: [{ id: CRS, name: 'Test Shop' }],
    APP_CONFIG: { accountLabel: 'C A/C I', cerealAccountNo: '10828605763' },
    CRS_ACCOUNTS: { [CRS]: '10828605763' },
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
  return { html: html.join('\n'), ws: sheets[0] };
}

/** Every row of the page as arrays of cell text. */
const rows = (html) => [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)]
  .map((m) => [...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
const totalRows = (html) => rows(html).filter((r) => r[1] === TOTAL_LABEL);
/** The figure printed after "C A/C I = <account> =". */
const accOf = (html) => html.match(/dss-acc-val">([\d.]+)</)?.[1] ?? null;

console.log('\n1. The TOTAL row carries the money alone');
{
  const { html } = run({ remits: [{ id: 'r1', amount: 4640, date: '2026-09-22', account: 'nc' }] });
  const tr = totalRows(html);
  check('the page has both TOTAL rows — main and police', tr.length === 2, String(tr.length));
  for (const [i, r] of tr.entries()) {
    const who = i === 0 ? 'main' : 'police';
    check(`${who}: the five kilo columns are blank`, r.slice(2, 7).every((c) => c === ''), JSON.stringify(r));
    check(`${who}: the row keeps its number, its label and ${RUPEE}`, r[0] === (i === 0 ? '25' : '7') && r[1] === TOTAL_LABEL && r[7] === RUPEE, JSON.stringify(r));
  }
  check('main TOTAL still states the money: 100 × 25 + 40 × 10 = 2900.00', tr[0][8] === '2900.00', tr[0][8]);
  check('police TOTAL states its own money: 2 × 12.50 = 25.00', tr[1][8] === '25.00', tr[1][8]);
  check('no summed kilos anywhere on the page (7216.000-style figures are gone)',
    !rows(html).some((r) => r[1] === TOTAL_LABEL && r.slice(2, 7).some((c) => /\d/.test(c))));
  const sugar = rows(html).find((r) => r[1] === 'சீனி');
  check('the commodity rows are untouched: sugar 500 / 500 / 100 / 400 and 2500.00',
    sugar && sugar[2] === '500.000' && sugar[4] === '500.000' && sugar[5] === '100.000' && sugar[6] === '400.000' && sugar[8] === '2500.00', JSON.stringify(sugar));
  const cis = rows(html).find((r) => r[1] === CIS);
  check('…and CIS still prices at the saved 10.00', cis && cis[7] === '10.00' && cis[8] === '400.00', JSON.stringify(cis));
}

console.log('\n2. C A/C states what was banked, not what was sold');
{
  const { html } = run({ remits: [{ id: 'r1', amount: 4640, date: '2026-09-22', account: 'nc' }] });
  check('banked 4640 against 2925.00 of sales → the line says 4640.00', accOf(html) === '4640.00', accOf(html));
  check('the account number is still printed', /C A\/C I = 10828605763 = /.test(html));

  const two = run({ remits: [
    { id: 'r1', amount: 4000, date: '2026-09-22', account: 'nc' },
    { id: 'r2', amount: 640.5, date: '2026-09-23', account: 'nc', reason: 'Bank holiday' },
  ] });
  check('two deposits for the date are added: 4000 + 640.50 = 4640.50', accOf(two.html) === '4640.50', accOf(two.html));

  const cereal = run({ remits: [
    { id: 'r1', amount: 1000, date: '2026-09-22', account: 'nc' },
    { id: 'r2', amount: 500, date: '2026-09-22', account: 'ce' },
  ] });
  check('a Cereal deposit counts too: 1000 + 500 = 1500.00', accOf(cereal.html) === '1500.00', accOf(cereal.html));

  const corrected = run({ remits: [{ id: 'r1', amount: 4500, date: '2026-09-22', account: 'nc' }] });
  check('an administrator correcting it to 4500 shows 4500.00 on the next DSS', accOf(corrected.html) === '4500.00', accOf(corrected.html));

  const removed = run({ remits: [] });
  check('the deposit removed: the line says 0.00, not the day\'s sales', accOf(removed.html) === '0.00', accOf(removed.html));
  const none = run({});
  check('a sheet with no remittance at all: 0.00', accOf(none.html) === '0.00', accOf(none.html));

  const legacy = run({ remitAmount: 3570, remitDate: '2026-09-18' });
  check('a sheet saved before deposits had ids: its remitAmount, 3570.00', accOf(legacy.html) === '3570.00', accOf(legacy.html));
  const both = run({ remitAmount: 999, remits: [{ id: 'r1', amount: 4640, date: '2026-09-22', account: 'nc' }] });
  check('the deposits win over an old remitAmount left beside them', accOf(both.html) === '4640.00', accOf(both.html));
}

console.log('\n3. The .xlsx says the same');
{
  const { ws } = run({ remits: [{ id: 'r1', amount: 4640, date: '2026-09-22', account: 'nc' }] });
  const blank = ['D', 'E', 'F', 'G', 'H'].filter((c) => ws[c + '35']?.v !== '');
  check('row 35 (main TOTAL): D–H are blank', blank.length === 0, JSON.stringify(blank.map((c) => [c + '35', ws[c + '35']?.v])));
  const blankB = ['D', 'E', 'F', 'G', 'H'].filter((c) => ws[c + '43']?.v !== '');
  check('row 43 (police TOTAL): D–H are blank', blankB.length === 0, JSON.stringify(blankB.map((c) => [c + '43', ws[c + '43']?.v])));
  check('the ruled box is kept on those cells', ['D', 'E', 'F', 'G', 'H'].every((c) => ws[c + '35']?.s?.border));
  check('the money cells still carry the totals: J35 2900, J43 25', ws.J35?.v === 2900 && ws.J43?.v === 25, JSON.stringify([ws.J35?.v, ws.J43?.v]));
  check('the label cells stay: C35/C43 the TOTAL word, I35/I43 the rupee word',
    ws.C35?.v === TOTAL_LABEL && ws.C43?.v === TOTAL_LABEL && ws.I35?.v === RUPEE && ws.I43?.v === RUPEE);
  check('G45, the account figure, is the 4640 banked', ws.G45?.v === 4640, JSON.stringify(ws.G45?.v));
  check('D45 still reads "C A/C I = 10828605763 = "', ws.D45?.v === 'C A/C I = 10828605763 = ', JSON.stringify(ws.D45?.v));
  const cisRow = Object.entries(ws).find(([a, v]) => a[0] === 'C' && v?.v === CIS)?.[0].slice(1);
  check('a commodity row still carries its kilos', ws['D' + cisRow]?.v === 200 && ws['G' + cisRow]?.v === 40, JSON.stringify([ws['D' + cisRow]?.v, ws['G' + cisRow]?.v]));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
