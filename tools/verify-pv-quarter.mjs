/**
 * The 3-month PV: past months from their PDFs, the current month from the
 * system (office, 2026-09-22).
 *
 *   node tools/verify-pv-quarter.mjs
 *
 * 1. The office's own CRS 9 June PDFs, if they are on this machine
 *    (~/Downloads/TNCSC) — every row, the gunny, police and the note; and
 *    the whole workbook uploaded at once, the other sheets stepped over.
 * 2. Built pages — positioned text exactly as pdf.js hands it over — for
 *    what a real file can throw: empty cells, a transfer in or out, a row
 *    that does not add up, the wrong shop or month, a sheet missing.
 * 3. The chain: July → August → September must carry, or the PV is refused
 *    with the difference; police only where the shop has it (and from the
 *    month it starts); gunny carried; notes printed under Gunny only.
 * 4. September from the stores, worked out the way Monthly Entry and Gunny
 *    Stock show it.
 * 5. The automatic PV is byte-identical to `dev`'s.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(s,c,n){if(s.startsWith('@/'))return n(${JSON.stringify(srcUrl)}+s.slice(2)+(/\\.[a-z]+$/.test(s)?'':'.ts'),c);return n(s,c);}`,
  )}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const P = await imp('src/lib/engine/pvPdfParse.ts');
const Q = await imp('src/lib/engine/pvQuarter.ts');
const S = await imp('src/lib/engine/pvStatement.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const refused = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof P.PdfReadError ? e.message : `NOT A PdfReadError: ${e}`;
  }
};
const J = (v) => JSON.stringify(v);

// ── 1. The office's PDFs ─────────────────────────────────────────────────
console.log('\n1. The office\'s CRS 9 June 2026 PDFs');
const officeDir = join(homedir(), 'Downloads', 'TNCSC');
const officeFiles = existsSync(officeDir) ? readdirSync(officeDir).filter((f) => /^CRS 9 JUNE'26 .*\.pdf$/i.test(f)) : [];
if (!officeFiles.length) {
  console.log('  skip  not on this machine');
} else {
  const pdfjs = await imp('node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const pagesOf = async (f) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(officeDir, f))), verbosity: 0 }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      out.push({ file: f, items: tc.items.filter((i) => i.str?.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width })) });
    }
    await doc.destroy();
    return out;
  };
  const want = { crsId: 9, month: 6, year: 2026, needsPolice: true };
  const three = [];
  for (const f of officeFiles.filter((f) => /PAGE2|GUNNY|POLICE/i.test(f))) three.push(...(await pagesOf(f)));
  const m = P.readMonthPages(three, want);
  const row = (id) => { const r = m.rows[id]; return [r.open, r.receipt, r.total, r.sales, r.closing].join('/'); };
  check('B.RICE 1047 / 2500 / 3547 / 52 / 3495', row('BRA') === '1047/2500/3547/52/3495', row('BRA'));
  check('SUGAR(AAY) 13 / 18.5 / 31.5 / 19.5 / 12', row('AAY_SUGAR') === '13/18.5/31.5/19.5/12', row('AAY_SUGAR'));
  check('WHEAT 630 / 840 / 1470 / 445 / 1025', row('WHEAT') === '630/840/1470/445/1025', row('WHEAT'));
  check('PHH FRK 3255 / 3472 / 6727 / 3270 / 3457', row('PHH_FRK') === '3255/3472/6727/3270/3457', row('PHH_FRK'));
  check('C.BOX in pieces 0 / 47 / 47 / 47 / 0', row('EMPTY_BOX') === '0/47/47/47/0', row('EMPTY_BOX'));
  check('P.GUNNY in pieces 11 / 14 / 25 / 25 / 0', row('EMPTY_BAG') === '11/14/25/25/0', row('EMPTY_BAG'));
  check('every row adds up', Object.values(m.rows).every((r) => Math.abs(r.open + r.receipt + r.excess - r.shortage + r.transfer - r.sales - r.closing) < 0.001));
  check('Gunny 50KG SS 1186 + 189 = 1375 − 1300 = 75', J(m.gunny.ss50) === J({ opening: 1186, receipt: 189, total: 1375, issues: 1300, closing: 75 }), J(m.gunny.ss50));
  check('Gunny POLY 11 + 14 − 25 = 0, C. BOX 0 + 47 − 47 = 0', m.gunny.poly.closing === 0 && m.gunny.poly.total === 25 && m.gunny.cbox.receipt === 47);
  check('Police B.R.A 15 − 15 = 0; WHEAT 1.5 carried', m.police.PB_BRA.sales === 15 && m.police.PB_WHEAT.closing === 1.5, J(m.police));
  check('note read exactly: "WHEAT CONSIDER AS GUNNY"', J(m.notes) === J(['WHEAT CONSIDER AS GUNNY']), J(m.notes));

  const all = [];
  for (const f of officeFiles) all.push(...(await pagesOf(f)));
  const whole = P.readMonthPages(all, want);
  check(`all ${officeFiles.length} sheets at once: B6, Free Com, Cost Com, Page 1… stepped over, same month read`, J(whole) === J(m));
  const r = refused(() => P.readMonthPages(three, { ...want, crsId: 12 }));
  check('CRS 9\'s PDFs offered as CRS 12 are refused', !!r && /CRS 9's statement, not CRS 12's/.test(r), r);
  const r2 = refused(() => P.readMonthPages(three, { ...want, month: 7 }));
  check('June offered as July is refused', !!r2 && /June 2026, not July 2026/.test(r2), r2);
}

// ── 2. Built pages ───────────────────────────────────────────────────────
// Right-aligned figures, as the office's sheets print them: a figure ends at
// its column's right edge. Widths are ~4.5pt a character.
const W = (s) => String(s).length * 4.5;
const at = (str, x, y) => ({ str: String(str), x, y, w: W(str) });
const rightAt = (str, edge, y) => ({ str: String(str), x: edge - W(str), y, w: W(str) });
const MONTHS = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A CRS PAGE2: rows = { label: { open:[bags,kgs], receipt:[..], excess:kgs, shortage:kgs, transfer:kgs, total:[..], sales:[..], closing:[..] } }. */
function page2(crsId, month, rows, { year = 2026 } = {}) {
  const items = [
    at('TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION', 200, 20),
    at(`Monthly report for the month of ${MONTHS[month]}'${year}`, 240, 34),
    at('NAME OF THE B.C : SOMEONE', 60, 48), at(`CRS NO: ${crsId}`, 500, 48),
  ];
  // parent, and its leaves: BAGS+KGS pair or a lone KGS.
  const layout = [['OPENING', 2], ['RECEIPT', 2], ['EXCESS', 1], ['SHORTAG', 1], ['TRANSFER', 1], ['TOTAL', 2], ['SALES', 2], ['RATE', 0], ['AMOUNT', 0], ['CLOSING', 2]];
  const cols = {};
  let x = 120;
  for (const [name, n] of layout) {
    if (n === 0) {
      items.push(at(name, x, 90));
      x += 40;
      continue;
    }
    items.push(at(name, x, 76));
    const leaves = n === 2 ? ['BAGS', 'KGS'] : ['KGS'];
    cols[name] = [];
    for (const lf of leaves) {
      items.push(at(lf, x, 90));
      cols[name].push(x + W(lf)); // right edge of the heading
      x += 40;
    }
  }
  const field = { open: 'OPENING', receipt: 'RECEIPT', excess: 'EXCESS', shortage: 'SHORTAG', transfer: 'TRANSFER', total: 'TOTAL', sales: 'SALES', closing: 'CLOSING' };
  let y = 110;
  let sl = 1;
  for (const [label, v] of Object.entries(rows)) {
    items.push(at(String(sl++), 22, y), at(label, 40, y));
    for (const [f, val] of Object.entries(v)) {
      const edges = cols[field[f]];
      const pair = Array.isArray(val) ? val : [val];
      const e = edges.length === 2 && pair.length === 1 ? [edges[1]] : edges;
      pair.forEach((n, i) => { if (n !== '' && n !== undefined) items.push(rightAt(n, e[i] + 6, y)); });
    }
    y += 14;
  }
  return items;
}

function gunnySheet(crsId, month, rows, notes = []) {
  const items = [
    at('TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION', 150, 20),
    at(`CRS ${crsId}`, 280, 34),
    at(`GUNNY STOCK STATEMENT FOR THE MONTH OF ${MONTHS[month]}'2026`, 180, 48),
  ];
  const stages = ['OPENING', 'RECEIPT', 'TOTAL', 'ISSUES', 'CLOSING'];
  const edges = {};
  let x = 120;
  for (const s of stages) {
    items.push(at(s, x + 10, 70));
    items.push(at('GUNNY', x, 86), at('EMPTY', x + 40, 86));
    edges[s] = x + 40 + W('EMPTY'); // EMPTY GUNNY — where the office prints them all
    x += 90;
  }
  items.push(at('WITH GRAINS', 118, 96));
  let y = 112;
  for (const [label, g] of Object.entries(rows)) {
    items.push(at(label, 30, y));
    for (const [s, v] of Object.entries(g)) if (v !== '') items.push(rightAt(v, edges[s] + 4, y));
    y += 14;
  }
  y += 16;
  for (const n of notes) {
    items.push(at(n, 40, y));
    y += 12;
  }
  items.push(at('BILL CLERK SIGNATURE', 40, y + 30));
  return items;
}

function policeSheet(crsId, month, rows) {
  const items = [
    at('TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION', 150, 20),
    at(`POLICE RECEIPT FOR THE MONTH OF ${MONTHS[month]}'2026`, 170, 34),
    at(`CRS.${crsId}`, 280, 48),
  ];
  const heads = ['O.B', 'RECEIPT', 'TOTAL', 'SALES', 'RATE', 'AMOUNT', 'C.B'];
  const edges = {};
  let x = 140;
  items.push(at('SI NO', 20, 66), at('COMMODITY', 50, 66));
  for (const h of heads) {
    items.push(at(h, x, 66));
    edges[h] = x + W(h);
    x += 55;
  }
  let y = 82;
  let sl = 1;
  for (const [label, v] of Object.entries(rows)) {
    items.push(at(String(sl++), 22, y), at(label, 50, y));
    for (const [h, n] of Object.entries(v)) if (n !== '') items.push(rightAt(n, edges[h] + 6, y));
    y += 14;
  }
  items.push(at('TOTAL', 50, y));
  return items;
}

console.log('\n2. Built pages — what a real file can throw');
{
  const p = page2(9, 7, {
    'B.RICE': { open: [20, 1000], receipt: [50, 2500], total: [70, 3500], sales: [1, 50], closing: [69, 3450] },
    'A.A.Y': {},
    SUGAR: { open: [0, 100], excess: 5, total: [0, 105], sales: [0, 5], closing: [0, 100] },
    WHEAT: { open: 630, shortage: 10, total: 620, sales: 20, closing: 600 },
    CYL: { open: 400, transfer: 30, total: 430, sales: 30, closing: 400 },
    'P.OIL': { open: 400, transfer: 30, total: 370, sales: 0, closing: 370 },
    'RICE TOTAL': { open: 1000, total: 3500, closing: 3450 },
    'C.BOX': { open: [3, ''], receipt: [47, ''], total: [50, ''], sales: [45, ''], closing: [5, ''] },
  });
  const rows = P.readPage2(p);
  check('BAGS column read apart from KGS: B.RICE opens 1000 kg', rows.BRA.open === 1000 && rows.BRA.closing === 3450, J(rows.BRA));
  check('an empty row reads as zeros, not the next row\'s figures', J(rows.AAY) === J({ open: 0, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: 0, sales: 0, closing: 0 }));
  check('EXCESS 5 read into Excess', rows.SUGAR.excess === 5 && rows.SUGAR.receipt === 0);
  check('SHORTAGE 10 read into Shortage', rows.WHEAT.shortage === 10);
  check('a TRANSFER that adds is inward (+30)', rows.TOOR.transfer === 30, J(rows.TOOR));
  check('a TRANSFER that subtracts is outward (−30)', rows.PALM.transfer === -30, J(rows.PALM));
  check('RICE TOTAL (a subtotal) is not a commodity', !('RICE TOTAL' in rows) && !rows.RICE_TOTAL);
  check('C.BOX counted in pieces from the BAGS columns', rows.EMPTY_BOX.open === 3 && rows.EMPTY_BOX.closing === 5, J(rows.EMPTY_BOX));

  const bad = page2(9, 7, { 'B.RICE': { open: 1000, receipt: 2500, total: 3600, sales: 50, closing: 3550 } });
  const r1 = refused(() => P.readPage2(bad));
  check('a row whose Total is not Opening + Receipt is refused, with its figures', !!r1 && /B\.RICE: does not add up/.test(r1) && /3600/.test(r1), r1);
  const bad2 = page2(9, 7, { 'B.RICE': { open: 1000, total: 1000, sales: 50, closing: 900 } });
  const r2 = refused(() => P.readPage2(bad2));
  check('a row whose Closing is not Total − Sales is refused', !!r2 && /Closing says 900/.test(r2), r2);
  const bad3 = page2(9, 7, { 'MYSTERY DAL': { open: 1, total: 1, closing: 1 } });
  const r3 = refused(() => P.readPage2(bad3));
  check('an unknown row stops the read rather than being dropped', !!r3 && /MYSTERY DAL/.test(r3), r3);

  const g = gunnySheet(9, 7, {
    '50KG SS': { OPENING: 100, RECEIPT: 50, TOTAL: 150, ISSUES: 40, CLOSING: 110 },
    POLY: { OPENING: 5, RECEIPT: '', TOTAL: 5, ISSUES: '', CLOSING: 5 },
    'C. BOX': {},
  }, ['WHEAT CONSIDER AS GUNNY']);
  const gr = P.readGunny(g);
  check('Gunny 50KG SS 100 + 50 = 150 − 40 = 110', J(gr.gunny.ss50) === J({ opening: 100, receipt: 50, total: 150, issues: 40, closing: 110 }), J(gr.gunny.ss50));
  check('Gunny POLY with empty cells: 5 carried', gr.gunny.poly.opening === 5 && gr.gunny.poly.closing === 5 && gr.gunny.poly.receipt === 0);
  check('Gunny C. BOX with nothing: zeros', gr.gunny.cbox.total === 0);
  check('the note under the table, as written', J(gr.notes) === J(['WHEAT CONSIDER AS GUNNY']), J(gr.notes));
  const g2 = P.readGunny(gunnySheet(9, 7, { '50KG SS': { OPENING: 1, TOTAL: 1, CLOSING: 1 } }, ['Ragi considered as Gunny', 'P.OIL TINS CONSIDERED AS C.BOX']));
  check('a different shop\'s notes, each line, in its own words', J(g2.notes) === J(['Ragi considered as Gunny', 'P.OIL TINS CONSIDERED AS C.BOX']), J(g2.notes));
  const g3 = P.readGunny(gunnySheet(9, 7, { '50KG SS': { OPENING: 1, TOTAL: 1, CLOSING: 1 } }));
  check('no note: nothing invented (the signature line is not a note)', g3.notes.length === 0, J(g3.notes));
  const r4 = refused(() => P.readGunny(gunnySheet(9, 7, { POLY: { OPENING: 5, RECEIPT: 5, TOTAL: 11, CLOSING: 11 } })));
  check('a gunny row that does not add up is refused', !!r4 && /POLY: does not add up/.test(r4), r4);

  const pol = P.readPolice(policeSheet(9, 7, {
    'B.R.A': { 'O.B': 15, TOTAL: 15, SALES: 15, RATE: '1.00', AMOUNT: '15.00', 'C.B': 0 },
    WHEAT: { 'O.B': 1.5, TOTAL: 1.5, 'C.B': 1.5 },
  }));
  check('Police: RATE and AMOUNT are not stock', pol.PB_BRA.sales === 15 && pol.PB_BRA.closing === 0, J(pol.PB_BRA));
  check('Police: C.B read into Closing, not shifted', pol.PB_WHEAT.closing === 1.5 && pol.PB_WHEAT.sales === 0, J(pol.PB_WHEAT));

  // A month, from its pages.
  const pages = (crs, mo, withPolice = true) => [
    { file: 'p2.pdf', items: page2(crs, mo, { 'B.RICE': { open: 1000, total: 1000, closing: 1000 } }) },
    { file: 'gunny.pdf', items: gunnySheet(crs, mo, { '50KG SS': { OPENING: 1, TOTAL: 1, CLOSING: 1 } }) },
    ...(withPolice ? [{ file: 'police.pdf', items: policeSheet(crs, mo, { 'B.R.A': { 'O.B': 1, TOTAL: 1, 'C.B': 1 } }) }] : []),
  ];
  const ok = P.readMonthPages(pages(9, 7), { crsId: 9, month: 7, year: 2026, needsPolice: true });
  check('Page 2 + Gunny + Police: one month', ok.rows.BRA.open === 1000 && ok.police.PB_BRA.open === 1);
  const noPol = P.readMonthPages(pages(9, 7, false), { crsId: 9, month: 7, year: 2026, needsPolice: false });
  check('a shop without police: Page 2 + Gunny is the whole month, police null', noPol.police === null);
  const r5 = refused(() => P.readMonthPages(pages(9, 7, false), { crsId: 9, month: 7, year: 2026, needsPolice: true }));
  check('a police shop without its Police sheet is told what it still needs', !!r5 && / still needs CRS POLICE/.test(r5), r5);
  const r6 = refused(() => P.readMonthPages(pages(9, 7).slice(0, 1), { crsId: 9, month: 7, year: 2026, needsPolice: true }));
  check('…and lists every sheet still missing', !!r6 && /still needs GUNNY and CRS POLICE/.test(r6), r6);
  const r7 = refused(() => P.readMonthPages([...pages(9, 7), pages(9, 7)[0]], { crsId: 9, month: 7, year: 2026, needsPolice: true }));
  check('the same sheet uploaded twice is refused', !!r7 && /second CRS PAGE2/.test(r7), r7);
  const r8 = refused(() => P.readMonthPages([...pages(9, 7).slice(0, 2), pages(10, 7)[2]], { crsId: 9, month: 7, year: 2026, needsPolice: true }));
  check('another shop\'s Police sheet among CRS 9\'s is refused — no mixing', !!r8 && /CRS 10's statement, not CRS 9's/.test(r8), r8);
  const r9 = refused(() => P.readMonthPages(pages(9, 8), { crsId: 9, month: 7, year: 2026, needsPolice: true }));
  check('August\'s PDFs dropped on July are refused', !!r9 && /August 2026, not July 2026/.test(r9), r9);
}

// ── 3. The chain ─────────────────────────────────────────────────────────
console.log('\n3. July → August → September');
const F = (open, receipt, sales, o = {}) => {
  const f = { open, receipt, excess: 0, shortage: 0, transfer: 0, sales, ...o };
  f.total = open + receipt + f.excess - f.shortage + f.transfer;
  f.closing = f.total - sales;
  return f;
};
const G = (opening, receipt, issues) => ({ opening, receipt, total: opening + receipt, issues, closing: opening + receipt - issues });
const month = (label, source, rows, gunny, police = null, notes = []) => ({ label, source, rows, gunny, police, notes });
const gun = (a, b, c) => ({ ss50: a, poly: b, cbox: c });
{
  const jul = month('July 2026', 'pdf', { BRA: F(1000, 2500, 50), WHEAT: F(630, 0, 30, { shortage: 10 }), TOOR: F(400, 0, 30, { transfer: 30 }) },
    gun(G(100, 50, 40), G(5, 0, 0), G(0, 47, 47)), { PB_BRA: F(15, 0, 15) }, ['WHEAT CONSIDER AS GUNNY']);
  const aug = month('August 2026', 'pdf', { BRA: F(3450, 0, 400), WHEAT: F(590, 100, 50, { excess: 2 }), TOOR: F(400, 20, 20, { transfer: -10 }) },
    gun(G(110, 20, 30), G(5, 3, 1), G(0, 10, 10)), { PB_BRA: F(0, 10, 5) }, ['Wheat consider as Gunny']);
  const sep = month('September 2026', 'system', { BRA: F(3050, 500, 200), WHEAT: F(642, 0, 42), TOOR: F(390, 0, 90) },
    gun(G(100, 0, 0), G(7, 0, 7), G(0, 0, 0)), { PB_BRA: F(5, 0, 5) });
  const q = Q.chainQuarter(9, [jul, aug, sep]);
  check('a quarter that carries is accepted', q.ok, J(q.problems));
  const b = q.rows.BRA;
  check('BRA: Opening from July 1000, Receipt 3000, Issues 650, Balance 3350', b.open === 1000 && b.receipt === 3000 && b.sales === 650 && b.closing === 3350, J(b));
  const w = q.rows.WHEAT;
  check('WHEAT: shortage 10 and excess 2 kept in their own columns', w.shortage === 10 && w.excess === 2 && w.closing === 600, J(w));
  check('TOOR: net transfer +30 − 10 = +20', q.rows.TOOR.transfer === 20 && q.rows.TOOR.closing === 300, J(q.rows.TOOR));
  check('Opening + Receipt + Transfer + Excess − Sales − Shortage = Balance, every row',
    Object.values(q.rows).every((r) => Math.abs(r.open + r.receipt + r.transfer + r.excess - r.sales - r.shortage - r.closing) < 0.001));
  check('Gunny 50KG SS: 100 opening, 70 receipt, 70 issues, 100 closing', J(q.gunny.ss50) === J({ opening: 100, receipt: 70, total: 170, issues: 70, closing: 100 }), J(q.gunny.ss50));
  check('Police carried: 15 → 0 → 5 → 0', q.police.PB_BRA.open === 15 && q.police.PB_BRA.closing === 0, J(q.police.PB_BRA));
  check('the note once, as July wrote it (August\'s same words in lower case not repeated)', J(q.notes) === J(['WHEAT CONSIDER AS GUNNY']), J(q.notes));

  const { commMap, gunny, gunnyNotes } = Q.quarterPvInputs(q);
  check('PV TOTAL = Opening + Receipt + Transfer + Excess (TOOR 400 + 20 + 20)', commMap.TOOR.total === 440 && commMap.TOOR.issues === 140);
  const html = S.buildPVTable({ commMap, gunny, gunnyNotes, periodLabel: 'JUL-2026 TO SEP-2026', crsId: 9, crsName: 'X', billClerk: 'B' });
  check('the note prints under the Gunny rows', /Gunny[\s\S]*C\.BOX[\s\S]*WHEAT CONSIDER AS GUNNY/.test(html) && !/WHEAT CONSIDER AS GUNNY[\s\S]*C\.BOX/.test(html));
  const POLICE_HEAD = /background:#F5F5F5">Police<\/td>/;
  check('the police section prints for a police shop, with its rows', POLICE_HEAD.test(html) && /BRA Rice \(Police\)/.test(html));
  check('Preview and Print are one document: the same builder, the same bytes',
    html === S.buildPVTable({ commMap, gunny, gunnyNotes, periodLabel: 'JUL-2026 TO SEP-2026', crsId: 9, crsName: 'X', billClerk: 'B' }));

  // Mismatch: August opens at something other than July's closing.
  const augBad = { ...aug, rows: { ...aug.rows, BRA: F(3400, 0, 350) } };
  const bad = Q.chainQuarter(9, [jul, augBad, { ...sep, rows: { ...sep.rows, BRA: F(3050, 500, 200) } }]);
  check('August not opening at July\'s closing refuses the PV',
    !bad.ok && bad.problems.some((p) => /July 2026 closes at 3450, but August 2026 opens at 3400 \(difference -50\)/.test(p)), J(bad.problems ?? []));
  const sepBad = { ...sep, rows: { ...sep.rows, WHEAT: F(640, 0, 40) } };
  const bad2 = Q.chainQuarter(9, [jul, aug, sepBad]);
  check('September not opening at August\'s closing refuses the PV, naming the commodity',
    !bad2.ok && bad2.problems.some((p) => /August 2026 closes at 642, but September 2026 opens at 640/.test(p)), J(bad2.problems ?? []));
  const gBad = Q.chainQuarter(9, [jul, { ...aug, gunny: { ...aug.gunny, ss50: G(111, 19, 30) } }, sep]);
  check('Gunny that does not carry refuses the PV too', !gBad.ok && gBad.problems.some((p) => /Gunny 50 KG SS GUNNY: July 2026 closes at 110, but August 2026 opens at 111/.test(p)), J(gBad.problems ?? []));

  // No police shop.
  const np = Q.chainQuarter(10, [{ ...jul, police: null }, { ...aug, police: null }, { ...sep, police: null }]);
  check('a shop without police: no police rows at all', np.ok && np.police === null);
  const npHtml = S.buildPVTable({ ...Q.quarterPvInputs(np), periodLabel: 'P', crsId: 10, crsName: 'X', billClerk: 'B' });
  check('…and no police section on its PV — not even an empty heading', !POLICE_HEAD.test(npHtml) && !/\(Police\)/.test(npHtml));

  // Police ration given in August: the police section starts there.
  const mid = Q.chainQuarter(12, [{ ...jul, police: null }, aug, sep]);
  check('police from August: opens at August\'s O.B, no July mismatch', mid.ok && mid.police.PB_BRA.open === 0 && mid.police.PB_BRA.receipt === 10, J(mid.ok ? mid.police : mid.problems));

  // No note anywhere: no note line.
  const nn = Q.chainQuarter(9, [{ ...jul, notes: [] }, { ...aug, notes: [] }, sep]);
  const nnHtml = S.buildPVTable({ ...Q.quarterPvInputs(nn), periodLabel: 'P', crsId: 9, crsName: 'X', billClerk: 'B' });
  check('no note in the PDFs: no note line on the PV', !/pv-gunny-note/.test(nnHtml));
}

// ── 4. September from the system ─────────────────────────────────────────
console.log('\n4. The current month from the stores');
{
  const key = '9_9_2026';
  const stores = {
    entryStore: {},
    inspectionStore: {},
    receiptStore: [],
    meManualStore: {
      [key]: {
        a: { BRA: { open: 3050, receipt: 500, total: 3550, sales: 200, close: 3350 }, WHEAT: { open: 642, receipt: 0, total: 642, sales: 40, cs: 2, close: 600 } },
        b: { PB_BRA: { open: 5, receipt: 0, total: 5, sales: 5, close: 0 } },
      },
      '10_9_2026': { a: { BRA: { open: 999, receipt: 0, total: 999, sales: 0, close: 999 } }, b: {} },
    },
    meGunnyStore: { '9_8_2026': { ss50: { closing: 100 } }, [key]: { ss50: { issues: 30, receiptImported: 20 } } },
    salesCloseStore: {},
  };
  const sep = Q.systemQuarterMonth(9, 9, 2026, stores, true);
  check('September BRA as Monthly Entry publishes it: 3050 → 3350', sep.rows.BRA.open === 3050 && sep.rows.BRA.closing === 3350, J(sep.rows.BRA));
  check('C.S leaves stock as a sale: WHEAT sales 40 + 2', sep.rows.WHEAT.sales === 42 && sep.rows.WHEAT.closing === 600, J(sep.rows.WHEAT));
  check('its gunny as the Gunny Stock screen: 100 carried + 20 − 30 = 90', J(sep.gunny.ss50) === J({ opening: 100, receipt: 20, total: 120, issues: 30, closing: 90 }), J(sep.gunny.ss50));
  check('police for a police shop', sep.police?.PB_BRA.open === 5);
  check('another shop\'s month never reaches it (CRS 10\'s 999 absent)', !Object.values(sep.rows).some((r) => r.open === 999));
  const sepNo = Q.systemQuarterMonth(9, 9, 2026, stores, false);
  check('no police flag: no police section, even though police stores exist', sepNo.police === null);
  stores.meManualStore[key].a.BRA = { open: 3050, receipt: 600, total: 3650, sales: 200, close: 3450 };
  const again = Q.systemQuarterMonth(9, 9, 2026, stores, true);
  check('nothing cached: a change to the stores is in the next read', again.rows.BRA.receipt === 600 && again.rows.BRA.closing === 3450, J(again.rows.BRA));
  const transfer = Q.systemQuarterMonth(9, 9, 2026, { ...stores, meManualStore: { [key]: { a: { TOOR: { open: 400, receipt: 0, transfer: 30, total: 370, sales: 0, close: 370 } }, b: {} } } }, false);
  check('a stored outward transfer (+30) is −30 in the chain', transfer.rows.TOOR.transfer === -30, J(transfer.rows.TOOR));
}

// ── 5. The automatic PV is dev's ─────────────────────────────────────────
console.log('\n5. The automatic PV, unchanged');
{
  let devSrc = null;
  try {
    devSrc = execFileSync('git', ['show', 'dev:src/lib/engine/pvStatement.ts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* no dev branch here */ }
  if (!devSrc) console.log('  skip  no `dev` branch to compare with');
  else {
    const dir = mkdtempSync(join(tmpdir(), 'pvq-'));
    const f = join(dir, 'pvStatement.dev.ts');
    writeFileSync(f, devSrc);
    const D = await import(pathToFileURL(f).href);
    const commMap = {
      BRA: { name: 'B.RICE', unit: 'KG', open: 1047, receipt: 2500, total: 3547, issues: 52, closing: 3495, amount: 0, free: true },
      SUGAR: { name: 'SUGAR', unit: 'KG', open: 647.5, receipt: 754, total: 1401.5, issues: 712, closing: 689.5, amount: 17800, free: false },
      PALM: { name: 'P.OIL', unit: 'LTR', open: 426, receipt: 459, total: 885, issues: 473, closing: 412, amount: 11825, free: false },
      PB_BRA: { name: 'B.R.A', unit: 'KG', open: 15, receipt: 0, total: 15, issues: 15, closing: 0, amount: 0, free: false },
    };
    const opts = { commMap, periodLabel: 'JUL-2026 TO SEP-2026', crsId: 9, crsName: 'SHOP', gunny: { ss50: { opening: 1186, receipt: 189, total: 1375, issues: 1300, closing: 75 } }, billClerk: 'BC', pvOfficer: 'O', pvDate: '01-10-2026' };
    check('same input, byte-identical to dev\'s PV', S.buildPVTable(opts) === D.buildPVTable(opts));
    check('…for a CRS 29 PV too', S.buildPVTable({ ...opts, crsId: 29 }) === D.buildPVTable({ ...opts, crsId: 29 }));
  }
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
