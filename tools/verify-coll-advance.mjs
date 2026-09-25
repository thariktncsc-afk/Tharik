/**
 * COLL: an Advance receipt never reaches the closing balance, and prints in
 * the ADVANCE FOR THE MONTH OF … table instead (office, 2026-09-25).
 *
 *   node tools/verify-coll-advance.mjs
 *
 * The office asked for the Collector's sheet to state the month's own stock
 * movement, with stock drawn ahead for next month listed separately below it.
 * Two things had to change: `rcpHasRowsInMonth` / `rcpRegularQty` — which
 * 24-coll.js has always called — were defined NOWHERE in the generated engine
 * (33-receipt-type.js went in the port), so an Advance receipt counted as a
 * regular one all the way into RECEIVED FROM GODOWN, TOTAL and the CLOSING
 * BALANCE; and the advance table printed an empty template.
 *
 * Everything here runs through the real engine, on stores built in this file —
 * no database, nothing live.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

// ── The shop, the month, and the figures ─────────────────────────────────
const CRS = 7, MONTH = 9, YEAR = 2026, KEY = `${CRS}_${MONTH}_${YEAR}`;
const CRS_MASTER = [{ id: CRS, code: '22XX001PN', coll: true, police: true, status: 'Active' }];

/** open + receipt (BOTH types, as the roll-up totals them) − sales = close. */
const rec = (open, receipt, sales) => ({ open, receipt, total: open + receipt, sales, close: open + receipt - sales, amount: 0, excess: 0, shortage: 0, transfer: 0 });

/** Regular 300, Advance 500 — and AAY, which the office's advance table has no row for. */
const MONTHLY = {
  [KEY]: {
    a: {
      BRA: rec(1000, 800, 200),        // 300 regular + 500 advance
      WHEAT: rec(500, 300, 100),       // 300 regular, no advance
      PHH_BRA: rec(2000, 1950, 2000),  // the whole receipt is an advance
      AAY: rec(250, 250, 175),         // advance for a commodity with no row
      SUGAR: rec(100, 0, 0),           // nothing at all
    },
    b: { PB_BRA: rec(15, 10, 5) },
  },
};
const RECEIPTS = [
  { id: 1, crsId: CRS, date: '2026-09-04', type: 'regular', items: { BRA: { qty: 300 }, WHEAT: { qty: 300 } } },
  { id: 2, crsId: CRS, date: '2026-09-24', type: 'advance', items: { BRA: { qty: 500 }, PHH_BRA: { qty: 1950 }, AAY: { qty: 250 } } },
  { id: 3, crsId: CRS, date: '2026-09-11', type: 'regular', items: { PB_BRA: { qty: 10 } } },
  // Another shop's advance, and another month's — neither may reach this sheet.
  { id: 4, crsId: CRS + 1, date: '2026-09-20', type: 'advance', items: { BRA: { qty: 9999 } } },
  { id: 5, crsId: CRS, date: '2026-08-20', type: 'advance', items: { BRA: { qty: 8888 } } },
];

function render(stores) {
  const engine = createStatementEngine({
    stores: {
      entryStore: {}, inspectionStore: {}, monthlyStore: MONTHLY, meManualStore: {}, meSourceStore: {},
      meRemitStore: {}, meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, meAllotStore: {},
      meCardConfirmed: {}, meAdvanceStore: {}, receiptStore: [], ...stores,
    },
    users: [], CRS_MASTER,
    CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Shop ${i + 1}`, ...(i + 1 === CRS ? CRS_MASTER[0] : {}) })),
  });
  const d = engine.getData(CRS, MONTH, YEAR);
  return { engine, d, coll: engine.buildSection('coll', d) };
}

/**
 * The main report as label → [OB, Allotment, Received, Total, Sales, Closing].
 * The POLICE block repeats the labels BRA / SUGAR / WHEAT / T.DHALL / P.OIL,
 * so its rows are kept apart under `police`.
 */
function mainRows(html) {
  const body = html.slice(html.indexOf('<tbody>'), html.lastIndexOf('cl-adv-title'));
  const out = {};
  out.police = {};
  let inPolice = false;
  for (const m of body.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    const cells = [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => c[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length === 1) {
      if (/POLICE/i.test(cells[0])) inPolice = true;
      continue;
    }
    if (cells.length === 7 && cells[0]) {
      (inPolice ? out.police : out)[cells[0]] = cells.slice(1).map((v) => (v === '' ? 0 : Number(v)));
    }
  }
  return out;
}
/** The advance table, in printed order: [[label, cell], …]. */
function advRows(html) {
  const tail = html.slice(html.lastIndexOf('cl-adv-title'));
  const out = [];
  for (const m of tail.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    const cells = [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => c[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length === 2) out.push(cells);
  }
  return out;
}

console.log('\n1. An Advance receipt stays out of the closing balance');
const { coll, d, engine } = render({ receiptStore: RECEIPTS });
const R = mainRows(coll);
{
  // BRA: 1000 opening, 300 regular + 500 advance received, 200 sold.
  check('BRA receives only the regular 300 (not 800)', R.BRA[2] === 300, JSON.stringify(R.BRA));
  check('BRA total 1000 + 300 = 1300, closing 1300 − 200 = 1100', R.BRA[3] === 1300 && R.BRA[5] === 1100, JSON.stringify(R.BRA));
  check('PHH BRA, whose whole receipt was an advance: received 0, closing 0', R['PHH BRA'][2] === 0 && R['PHH BRA'][5] === 0, JSON.stringify(R['PHH BRA']));
  check('WHEAT, regular only: received 300, closing 700 — untouched', R.WHEAT[2] === 300 && R.WHEAT[5] === 700, JSON.stringify(R.WHEAT));
  check('SUGAR, nothing received: closing is its opening 100', R.SUGAR[5] === 100, JSON.stringify(R.SUGAR));
  check('POLICE BRA keeps its regular receipt: 15 + 10 − 5 = 20', R.police.BRA[2] === 10 && R.police.BRA[5] === 20, JSON.stringify(R.police.BRA));
  const every = [...Object.entries(R), ...Object.entries(R.police)].filter(([k, v]) => k !== 'TOTAL' && k !== 'police' && Array.isArray(v));
  check('every row still reads Opening + Allotment + Received − Sales = Closing',
    every.every(([, v]) => Math.abs(v[0] + v[1] + v[2] - v[4] - v[5]) < 0.001),
    JSON.stringify(Object.fromEntries(every.filter(([, v]) => Math.abs(v[0] + v[1] + v[2] - v[4] - v[5]) >= 0.001))));
  check('another shop\'s advance (9999) never reaches this sheet', !coll.includes('9999'));
  check('another month\'s advance (8888) never reaches this sheet', !coll.includes('8888'));
}

console.log('\n2. The advance prints below, commodity by commodity');
{
  const A = advRows(coll);
  const at = (label) => (A.find((r) => r[0] === label) ?? [])[1];
  check('the office\'s rows are in the office\'s order',
    A.slice(0, 11).map((r) => r[0]).join('|') === 'NPHH FRK|PHH FRK|BRA|RRA|SUGAR|AAY SUGAR|PHH BRA|AAY FRK|WHEAT|T.DHALL|P.OIL',
    A.map((r) => r[0]).join('|'));
  check('BRA 500 — the advance, not the 800 received in all', at('BRA') === '500', at('BRA'));
  check('PHH BRA 1950 prints in the row the office\'s second "PHH FRK" holds', at('PHH BRA') === '1950', at('PHH BRA'));
  check('a commodity with no row of its own is added below: AAY 250',
    A[11] && A[11][0] === 'AAY' && A[11][1] === '250', JSON.stringify(A.slice(11)));
  check('WHEAT, received regular only, stays blank', at('WHEAT') === '', JSON.stringify(at('WHEAT')));
  check('nothing else is invented — 12 rows for 11 office rows + 1 extra', A.length === 12, String(A.length));
  const advTotal = A.reduce((t, r) => t + (Number(r[1]) || 0), 0);
  check('the advance table totals exactly the advance receipt: 500 + 1950 + 250', advTotal === 2700, String(advTotal));
}

console.log('\n3. Nothing else is touched');
{
  // The same month with the advance row typed Regular instead: the sheet is
  // the old behaviour, which is what "only advances are excluded" means.
  const asRegular = RECEIPTS.map((r) => (r.id === 2 ? { ...r, type: 'regular' } : r));
  const RR = mainRows(render({ receiptStore: asRegular }).coll);
  check('typed Regular, BRA is back to 800 received and 1600 closing', RR.BRA[2] === 800 && RR.BRA[5] === 1600, JSON.stringify(RR.BRA));
  check('…and the advance table is empty', advRows(render({ receiptStore: asRegular }).coll).every((r) => r[1] === ''));

  // A row saved before the type field existed is a regular delivery.
  const noType = RECEIPTS.map((r) => (r.id === 2 ? { ...r, type: undefined } : r));
  check('a receipt with no type at all counts as Regular', mainRows(render({ receiptStore: noType }).coll).BRA[2] === 800);

  // No receipt register at all: the sheet falls back to the monthly figure.
  const none = mainRows(render({ receiptStore: [] }).coll);
  check('a month with no receipt rows still prints its monthly receipt (800)', none.BRA[2] === 800, JSON.stringify(none.BRA));

  // Every other section still counts the advance — the grain IS in the shop.
  const page2 = engine.buildSection('crs_page2', d);
  check('CRS PAGE2 still counts the advance (800 received, 1600 closing)', /800/.test(page2) && /1600/.test(page2));
  const rbi = engine.buildSection('rbi', d);
  check('RBI still counts it too', /1600/.test(rbi));
  check('the advance table prints nowhere but COLL', !/ADVANCE FOR THE MONTH/.test(page2) && !/ADVANCE FOR THE MONTH/.test(rbi));
}

console.log('\n4. The sheet the office files');
{
  check('the title still names next month', /ADVANCE FOR THE MONTH OF OCT'2026/.test(coll), '');
  check('COLL still has no signature line', !/AREA SUPERVISOR|AREA SUPERINTENDENT/i.test(coll));
  check('the shop code still prints alone under the title', coll.includes('22XX001PN'));
  check('the report keeps its seven columns', (coll.match(/<th>/g) ?? []).length === 7, String((coll.match(/<th>/g) ?? []).length));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
