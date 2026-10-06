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
 * 5. The sheet: the office's 38-column Annexure-I on ONE Legal landscape page,
 *    laid out in millimetres; Shortage red and Excess green, and nothing else;
 *    printed by Chrome and read back out of the PDF.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire, register } from 'node:module';
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
  const { skipped, ...wholeRest } = whole;
  const { skipped: _s, ...threeRest } = m;
  check(`all ${officeFiles.length} sheets at once: B6, Free Com, Cost Com, Page 1… stepped over, same month read`, J(wholeRest) === J(threeRest));
  check(`…and the ${officeFiles.length - 3} other sheets are named as stepped over (B6, Free Com and Cost Com among them)`,
    skipped.length === officeFiles.length - 3 && ['B6', 'FREE COM', 'COST COM'].every((n) => skipped.some((f) => f.toUpperCase().includes(n))), J(skipped));
  const r = refused(() => P.readMonthPages(three, { ...want, crsId: 12 }));
  check('CRS 9\'s PDFs offered as CRS 12 are refused', !!r && /CRS 9's statement, not CRS 12's/.test(r), r);
  const r2 = refused(() => P.readMonthPages(three, { ...want, month: 7 }));
  check('June offered as July is refused', !!r2 && /June 2026, not July 2026/.test(r2), r2);
}

// The office's CRS 1 July and August 2026 — the files that were reported as
// "still needs CRS PAGE2" (their PAGE2 has no EXCESS / SHORTAGE columns).
console.log('\n1b. The office\'s CRS 1 July and August 2026 PDFs');
const crs1Dir = join(homedir(), 'Downloads');
const crs1 = (tag, s) => join(crs1Dir, `CRS 1 ${tag} - ${s}`);
if (!existsSync(crs1("JULY'26", 'CRS PAGE2 .pdf')) || !existsSync(crs1("AUG'26", 'CRS PAGE2 .pdf'))) {
  console.log('  skip  not on this machine');
} else {
  const pdfjs = await imp('node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const pagesOf = async (f) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      out.push({ file: f.split(/[\\/]/).pop(), items: tc.items.filter((i) => i.str?.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width })) });
    }
    await doc.destroy();
    return out;
  };
  const months = {};
  for (const [mo, tag] of [[7, "JULY'26"], [8, "AUG'26"]]) {
    const p2 = await pagesOf(crs1(tag, 'CRS PAGE2 .pdf'));
    check(`${tag} PAGE2 is recognised as CRS PAGE2`, P.pageKindOf(p2[0].items) === 'page2');
    const all = [...p2];
    for (const s of ['GUNNY-2.pdf', 'CRS POLICE.pdf']) if (existsSync(crs1(tag, s))) all.push(...(await pagesOf(crs1(tag, s))));
    let m = null;
    try {
      m = P.readMonthPages(all, { crsId: 1, month: mo, year: 2026 });
    } catch (e) {
      check(`${tag}: PAGE2 + GUNNY + POLICE read`, false, e.message);
      continue;
    }
    months[mo] = m;
    const n = Object.keys(m.rows).length;
    check(`${tag}: PAGE2 + GUNNY + POLICE read — ${n} commodities, gunny ${m.gunny ? 'yes' : 'no'}, police ${m.police ? 'yes' : 'no'}`, n > 10 && !!m.gunny && !!m.police);
    check(`${tag}: every row adds up`, Object.values(m.rows).every((r) => Math.abs(r.open + r.receipt + r.excess - r.shortage + r.transfer - r.sales - r.closing) < 0.001));
    const alone = P.readMonthPages(p2, { crsId: 1, month: mo, year: 2026 });
    check(`${tag}: PAGE2 alone completes the month`, J(alone.rows) === J(m.rows) && alone.gunny === null && alone.police === null);
  }
  if (months[7] && months[8]) {
    const bad = Object.keys(months[7].rows).filter((id) => Math.abs((months[8].rows[id]?.open ?? 0) - months[7].rows[id].closing) > 0.001);
    const detail = bad.map((id) => `${id}: Jul CB ${months[7].rows[id].closing} → Aug OB ${months[8].rows[id]?.open}`).join('; ');
    // What the office's own sheets say — the chain reports it either way; this
    // records whether CRS 1's July → August carries.
    console.log(`  info  July → August carry: ${bad.length ? `${bad.length} commodities differ — ${detail}` : 'every commodity carries'}`);
    // The two uploaded months plus a September that opens where August closed.
    const sep = {
      label: 'September 2026', source: 'system', notes: [],
      rows: Object.fromEntries(Object.entries(months[8].rows).map(([id, r]) => [id, { open: r.closing, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: r.closing, sales: 0, closing: r.closing }])),
      gunny: Object.fromEntries(Object.entries(months[8].gunny).map(([k, g]) => [k, { opening: g.closing, receipt: 0, total: g.closing, issues: 0, closing: g.closing }])),
      police: Object.fromEntries(Object.entries(months[8].police).map(([id, r]) => [id, { open: r.closing, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: r.closing, sales: 0, closing: r.closing }])),
    };
    const q = Q.chainQuarter(1, [Q.pdfQuarterMonth(months[7]), Q.pdfQuarterMonth(months[8]), sep]);
    if (bad.length) check('a July → August break is refused, naming each commodity', !q.ok && q.problems.length >= bad.length, J(q.problems ?? []));
    else check('CRS 1 July + August + September chain into one quarter PV', q.ok, J(q.problems ?? []));
  }
}

// ── 2. Built pages ───────────────────────────────────────────────────────
// Right-aligned figures, as the office's sheets print them: a figure ends at
// its column's right edge. Widths are ~4.5pt a character.
const W = (s) => String(s).length * 4.5;
const at = (str, x, y) => ({ str: String(str), x, y, w: W(str) });
const rightAt = (str, edge, y) => ({ str: String(str), x: edge - W(str), y, w: W(str) });
const MONTHS = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A CRS PAGE2: rows = { label: { open:[bags,kgs], receipt:[..], excess:kgs, shortage:kgs, transfer:kgs, total:[..], sales:[..], closing:[..] } }. */
function page2(crsId, month, rows, { year = 2026, adjustments = true } = {}) {
  const items = [
    at('TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION', 200, 20),
    at(`Monthly report for the month of ${MONTHS[month]}'${year}`, 240, 34),
    at('NAME OF THE B.C : SOMEONE', 60, 48), at(`CRS NO: ${crsId}`, 500, 48),
  ];
  // The printed form always carries every commodity row, SUGAR included.
  if (!('SUGAR' in rows)) rows = { ...rows, SUGAR: {} };
  // parent, and its leaves: BAGS+KGS pair or a lone KGS. Some shops' PAGE2
  // has no EXCESS / SHORTAGE columns at all (CRS 1).
  const layout = [['OPENING', 2], ['RECEIPT', 2], ...(adjustments ? [['EXCESS', 1], ['SHORTAG', 1]] : []), ['TRANSFER', 1], ['TOTAL', 2], ['SALES', 2], ['RATE', 0], ['AMOUNT', 0], ['CLOSING', 2]];
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
  check('an empty row reads as zeros, not the next row\'s figures', J({ ...rows.AAY, bags: undefined }) === J({ open: 0, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: 0, sales: 0, closing: 0 }) && J(rows.AAY.bags) === J({ open: 0, receipt: 0, total: 0, sales: 0, closing: 0 }));
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
  const JUL = { crsId: 9, month: 7, year: 2026 };
  const ok = P.readMonthPages(pages(9, 7), JUL);
  check('Page 2 + Gunny + Police: one month', ok.rows.BRA.open === 1000 && ok.police.PB_BRA.open === 1 && ok.gunny.ss50.opening === 1);
  const noPol = P.readMonthPages(pages(9, 7, false), JUL);
  check('Page 2 + Gunny, no Police sheet: the month is complete, police null', noPol.police === null && noPol.gunny !== null);
  const only2 = P.readMonthPages(pages(9, 7).slice(0, 1), JUL);
  check('Page 2 alone completes the month — Gunny and Police are optional', only2.rows.BRA.open === 1000 && only2.gunny === null && only2.police === null);
  const r6 = refused(() => P.readMonthPages(pages(9, 7).slice(1), JUL));
  check('Gunny + Police without Page 2: still needs CRS PAGE2', !!r6 && /July 2026: still needs CRS PAGE2\.$/.test(r6), r6);
  const twice = P.readMonthPages([...pages(9, 7), pages(9, 7)[0], pages(9, 7)[1]], JUL);
  check('the same sheets uploaded twice count once', twice.rows.BRA.open === 1000 && twice.gunny.ss50.opening === 1);
  const other = { file: 'p2-other.pdf', items: page2(9, 7, { 'B.RICE': { open: 900, total: 900, closing: 900 } }) };
  const r7 = refused(() => P.readMonthPages([...pages(9, 7), other], JUL));
  check('two PAGE2s for one month with DIFFERENT figures are refused', !!r7 && /second CRS PAGE2 for July 2026 with different figures/.test(r7), r7);
  const r8 = refused(() => P.readMonthPages([...pages(9, 7).slice(0, 2), pages(10, 7)[2]], JUL));
  check('another shop\'s Police sheet among CRS 9\'s is refused — no mixing', !!r8 && /CRS 10's statement, not CRS 9's/.test(r8), r8);
  const r9 = refused(() => P.readMonthPages(pages(9, 8), JUL));
  check('August\'s PDFs dropped on July are refused', !!r9 && /August 2026, not July 2026/.test(r9), r9);

  // CRS 1's PAGE2 has no EXCESS / SHORTAGE columns. Requiring them stepped it
  // over as "another sheet" and left the month on "still needs CRS PAGE2".
  const plain = page2(1, 7, { 'B.RICE': { open: [20, 1000], receipt: [10, 500], transfer: 100, total: [32, 1600], sales: [2, 100], closing: [30, 1500] } }, { adjustments: false });
  check('a PAGE2 without EXCESS / SHORTAGE columns is recognised as PAGE2', P.pageKindOf(plain) === 'page2');
  const pm = P.readMonthPages([{ file: "CRS 1 JULY'26 - CRS PAGE2 .pdf", items: plain }], { crsId: 1, month: 7, year: 2026 });
  check('…and read: TRANSFER in its own column (+100), no excess or shortage', pm.rows.BRA.transfer === 100 && pm.rows.BRA.excess === 0 && pm.rows.BRA.closing === 1500, J(pm.rows.BRA));
  // A file named as a PAGE2 that is not laid out as one: said plainly.
  const notP2 = { file: "CRS 1 JULY'26 - CRS PAGE2 .pdf", items: [at("Monthly report for the month of JULY'2026", 200, 20), at('CRS NO: 1', 400, 34), at('B.RICE', 20, 60)] };
  // A Closing left blank (CRS 1's C.BOX / P.GUNNY) is Total − Sales; a printed 0 is 0.
  const blankCb = P.readPage2(page2(1, 7, { 'P.GUNNY': { open: [102, ''], receipt: [16, ''], total: [118, ''], sales: [74, ''] } }, { adjustments: false }));
  check('a blank Closing is Total − Sales (P.GUNNY 118 − 74 = 44), not 0', blankCb.EMPTY_BAG.closing === 44, J(blankCb.EMPTY_BAG));
  const zeroCb = refused(() => P.readPage2(page2(1, 7, { 'P.GUNNY': { open: [102, ''], total: [102, ''], sales: [74, ''], closing: [0, ''] } }, { adjustments: false })));
  check('…but a PRINTED Closing of 0 that does not add up is still refused', !!zeroCb && /Closing says 0/.test(zeroCb), zeroCb);
  const r10 = refused(() => P.readMonthPages([notP2], { crsId: 1, month: 7, year: 2026 }));
  check('a PAGE2 file that cannot be read is an error naming it, not a silent wait',
    !!r10 && /July 2026 CRS PAGE2 could not be read — CRS 1 JULY'26 - CRS PAGE2 \.pdf .*Please upload the correct PDF/.test(r10), r10);
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
  const html = S.buildPVTable({ commMap, gunny, gunnyNotes, periodLabel: 'JUL-2026 TO SEP-2026', crsId: 9, crsName: 'X', staff: { bc: 'B' } });
  check('the Gunny note prints in the NOTE row at the foot, once — not under the Gunny rows', /<b>NOTE:<\/b> <span class="note-text">WHEAT CONSIDER AS GUNNY<\/span>/.test(html) && (html.match(/WHEAT CONSIDER AS GUNNY/gi) ?? []).length === 1 && !/pv-gunny-note/.test(html));
  const POLICE_HEAD = /class="l sec">Police<\/td>/;
  check('the police section prints for a police shop, with its rows', POLICE_HEAD.test(html) && /BRA Rice \(Police\)/.test(html));
  check('Preview and Print are one document: the same builder, the same bytes',
    html === S.buildPVTable({ commMap, gunny, gunnyNotes, periodLabel: 'JUL-2026 TO SEP-2026', crsId: 9, crsName: 'X', staff: { bc: 'B' } }));

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
  const npHtml = S.buildPVTable({ ...Q.quarterPvInputs(np), periodLabel: 'P', crsId: 10, crsName: 'X', staff: { bc: 'B' } });
  check('…and no police section on its PV — not even an empty heading', !POLICE_HEAD.test(npHtml) && !/\(Police\)/.test(npHtml));

  // Police ration given in August: the police section starts there.
  const mid = Q.chainQuarter(12, [{ ...jul, police: null }, aug, sep]);
  check('police from August: opens at August\'s O.B, no July mismatch', mid.ok && mid.police.PB_BRA.open === 0 && mid.police.PB_BRA.receipt === 10, J(mid.ok ? mid.police : mid.problems));

  // GUNNY is optional for an uploaded month: gunny then starts at the first
  // month that has it.
  const noGunJul = Q.chainQuarter(9, [{ ...jul, gunny: null }, aug, sep]);
  check('no GUNNY sheet for July: gunny opens at August\'s figure, no mismatch', noGunJul.ok && noGunJul.gunny.ss50.opening === 110 && noGunJul.gunny.ss50.receipt === 20, J(noGunJul.ok ? noGunJul.gunny.ss50 : noGunJul.problems));
  const noGunAug = Q.chainQuarter(9, [jul, { ...aug, gunny: null }, { ...sep, gunny: gun(G(110, 0, 10), G(5, 0, 0), G(0, 0, 0)) }]);
  check('no GUNNY sheet for August: July carries straight to September', noGunAug.ok && noGunAug.gunny.ss50.closing === 100, J(noGunAug.ok ? noGunAug.gunny.ss50 : noGunAug.problems));
  // POLICE missing in the middle month: stepped over, and the carry is still checked.
  const noPolAug = Q.chainQuarter(9, [jul, { ...aug, police: null }, sep]);
  check('no CRS POLICE for August: police steps over it and still checks July → September',
    !noPolAug.ok && noPolAug.problems.some((p) => /July 2026 closes at 0, but September 2026 opens at 5/.test(p)), J(noPolAug.problems ?? []));
  // A shop without police ration: a police sheet uploaded anyway is left out.
  check('a police sheet uploaded for a shop without police ration is not printed',
    Q.pdfQuarterMonth({ crsId: 2, month: 7, year: 2026, rows: {}, gunny: null, police: { PB_BRA: F(1, 0, 0) }, notes: [], skipped: [] }, false).police === null);

  // No note anywhere: no note line.
  const nn = Q.chainQuarter(9, [{ ...jul, notes: [] }, { ...aug, notes: [] }, sep]);
  const nnHtml = S.buildPVTable({ ...Q.quarterPvInputs(nn), periodLabel: 'P', crsId: 9, crsName: 'X', staff: { bc: 'B' } });
  check('no note in the PDFs: the NOTE row stands empty', /<b>NOTE:<\/b><\/td>/.test(nnHtml) && !/pv-gunny-note/.test(nnHtml));
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
  // The Receipt is Monthly Sales' own bags since 2026-09-30 (BRA 200 kg = 4 sacks, WHEAT 40 kg = 0):
  // the stored typed Receipt of 20 (receiptImported) is no longer read.
  check('its gunny as the Gunny Stock screen: 100 carried + 4 (Monthly Sales\' bags, not the typed 20) − 30 = 74', J(sep.gunny.ss50) === J({ opening: 100, receipt: 4, total: 104, issues: 30, closing: 74 }), J(sep.gunny.ss50));
  check('police for a police shop', sep.police?.PB_BRA.open === 5);
  check('another shop\'s month never reaches it (CRS 10\'s 999 absent)', !Object.values(sep.rows).some((r) => r.open === 999));
  const sepNo = Q.systemQuarterMonth(9, 9, 2026, stores, false);
  check('no police flag: no police section, even though police stores exist', sepNo.police === null);
  stores.meManualStore[key].a.BRA = { open: 3050, receipt: 600, total: 3650, sales: 200, close: 3450 };
  const again = Q.systemQuarterMonth(9, 9, 2026, stores, true);
  check('nothing cached: a change to the stores is in the next read', again.rows.BRA.receipt === 600 && again.rows.BRA.closing === 3450, J(again.rows.BRA));
  const transfer = Q.systemQuarterMonth(9, 9, 2026, { ...stores, meManualStore: { [key]: { a: { TOOR: { open: 400, receipt: 0, transfer: 30, total: 370, sales: 0, close: 370 } }, b: {} } } }, false);
  check('a stored outward transfer (+30) is −30 in the chain', transfer.rows.TOOR.transfer === -30, J(transfer.rows.TOOR));

  // Empty Polythene Bag / Empty Card+Box are SALES ONLY on the grid; their stock is Gunny's POLY / C.BOX
  // (CRS 1, 2026-09-30: "August closes at 15, but September opens at 0" while Gunny's POLY opened at 15).
  const k1 = '1_9_2026';
  const bags = {
    entryStore: {}, inspectionStore: {}, receiptStore: [], salesCloseStore: {},
    meManualStore: { [k1]: { a: { SUGAR: { open: 800, receipt: 0, total: 800, sales: 800, close: 0 }, EMPTY_BAG: { open: 0, receipt: 0, total: 0, sales: 0, close: 0 }, EMPTY_BOX: { open: 0, receipt: 0, total: 0, sales: 22, close: -22 } }, b: {} } },
    meGunnyStore: { [k1]: { poly: { opening: 15, openingAuto: false }, cbox: { opening: 0, openingAuto: false } } },
  };
  const s1 = Q.systemQuarterMonth(1, 9, 2026, bags, false);
  check(`Empty Polythene Bag is Gunny POLY: 15 + 16 (Sugar 800 kg ÷ 50) − 0 = 31 — ${J(s1.rows.EMPTY_BAG)}`, s1.rows.EMPTY_BAG.open === 15 && s1.rows.EMPTY_BAG.receipt === 16 && s1.rows.EMPTY_BAG.sales === 0 && s1.rows.EMPTY_BAG.closing === 31 && s1.gunny.poly.closing === 31);
  check(`Empty Card+Box is Gunny C.BOX: its Issues are the 22 sold — ${J(s1.rows.EMPTY_BOX)}`, s1.rows.EMPTY_BOX.open === 0 && s1.rows.EMPTY_BOX.sales === 22 && s1.rows.EMPTY_BOX.closing === s1.gunny.cbox.closing);
  const aug = { label: 'August 2026', source: 'pdf', notes: [], gunny: null, police: null,
    rows: { SUGAR: { open: 0, receipt: 800, excess: 0, shortage: 0, transfer: 0, total: 800, sales: 0, closing: 800 }, EMPTY_BAG: { open: 15, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: 15, sales: 0, closing: 15 }, EMPTY_BOX: { open: 0, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: 0, sales: 0, closing: 0 } } };
  const qOk = Q.chainQuarter(1, [aug, s1]);
  check('August P.GUNNY 15 → September POLY 15: no false mismatch', !(qOk.problems ?? []).some((p) => /Empty Polythene Bag|Empty Card\+Box/.test(p)), J(qOk.problems ?? []));
  const broken = JSON.parse(JSON.stringify(bags)); broken.meGunnyStore[k1].poly.opening = 0;
  const qBad = Q.chainQuarter(1, [aug, Q.systemQuarterMonth(1, 9, 2026, broken, false)]);
  check('a genuine break (September POLY opens at 0) is still refused', !qBad.ok && qBad.problems.some((p) => /Empty Polythene Bag: August 2026 closes at 15, but September 2026 opens at 0/.test(p)), J(qBad.problems ?? []));
}

// ── 5. The sheet, and the paper it prints on ─────────────────────────────
// Office, 2026-09-28: the PV is filed on LEGAL landscape (its own workbook is
// paperSize 5, landscape, fit to one page; every PV PDF it sent is 355.6 ×
// 215.9 mm, one page). The old sheet had 36 columns under title rows that
// spanned 39 and a number row that ran to 38 — the numbers and section rows
// stuck out past the commodity rows — and it printed a 1400px screen table
// onto A4, squeezed.
console.log('\n5. The sheet: Annexure-I, one Legal landscape page');
{
  const A = await imp('src/lib/engine/commodities.ts');
  const commMap = {};
  for (const c of [...A.DSS_A, ...A.DSS_B]) {
    // Every commodity there is, at the widest figures a shop has printed.
    commMap[c.id] = { name: c.en, unit: c.unit, open: 13312, receipt: 11376.5, total: 23242.5, issues: 10927.22, closing: 12299.78, amount: 0, free: !!c.free, transfer: -1456, shortage: 15.5, excess: 10 };
  }
  commMap.WHEAT = { ...commMap.WHEAT, shortage: 0, excess: 0, total: 23232.5, closing: 12305.28 };
  const html = S.buildPVTable({ commMap, periodLabel: '1.07.2026 TO 30.09.2026', crsId: 30, crsName: 'CRS 30', gunny: { ss50: { opening: 162, receipt: 605, total: 767, issues: 0, closing: 767 } }, gunnyNotes: ['WHEAT 46 CONSIDER AS GUNNY'], staff: { bc: 'BC' } });
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  check('38 columns, as the office\'s Annexure-I (B:AM)', S.PV_COLS === 38);
  check('the columns add up to the printed table: Legal less 18 mm each side', Math.abs(S.PV_TABLE_MM - (355.6 - 36)) < 0.01);
  check('printed on LEGAL landscape with the office\'s side margins', /@page\{size:legal landscape;margin:12mm 18mm\}/.test(css), css.slice(0, 120));
  check('on screen the sheet is a Legal page in millimetres — never the window\'s width',
    /\.pv-paper\{box-sizing:border-box;width:355\.6mm;min-height:215\.9mm/.test(css) && !/vw|min-width:1400px/.test(html));
  check('the print area is absolute, not fixed — a fixed one prints page 1 and no more', /#pv-print-area\{position:absolute/.test(css) && !/position:fixed/.test(css));

  const puppeteer = createRequire(join(root, 'package.json'))('puppeteer-core');
  const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
  if (!chrome) console.log('  skip  no Chrome on this machine to print with');
  else {
    const pdfjs = await imp('node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const printCss = readFileSync(join(root, 'src/app/print.css'), 'utf8');
    // The Reports screen as it prints: the app around it, printArea()'s body class.
    const doc = (bodyCls) => `<!doctype html><html><head><meta charset="utf-8"><style>${printCss}</style></head><body class="${bodyCls}"><div id="sidebar" style="height:100vh;width:240px">SIDEBAR</div><main id="main"><div id="content"><div class="card"><div style="overflow-x:auto"><div class="print-area">${html}</div></div></div></div></main></body></html>`;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage();
      const mm = (px) => (px / 96) * 25.4;
      for (const vw of [800, 1920]) {
        await page.setViewport({ width: vw, height: 900 });
        await page.setContent(doc(''));
        const s = await page.evaluate(() => ({ p: document.querySelector('.pv-paper').getBoundingClientRect().width, t: document.getElementById('pv-tbl').getBoundingClientRect().width }));
        check(`a ${vw}px window: the page is 355.6 mm, the table ${S.PV_TABLE_MM.toFixed(1)} mm`, Math.abs(mm(s.p) - 355.6) < 0.3 && Math.abs(mm(s.t) - S.PV_TABLE_MM) < 0.3, `${mm(s.p)} / ${mm(s.t)}`);
      }
      await page.emulateMediaType('print');
      await page.setContent(doc('printing-area'));
      const g = await page.evaluate((cols) => {
        const tbl = document.getElementById('pv-tbl');
        const span = (tr) => [...tr.cells].reduce((a, td) => a + (td.colSpan || 1), 0);
        const body = [...tbl.tBodies[0].rows].every((tr) => span(tr) === cols);
        const foot = [...tbl.tFoot.rows].every((tr) => span(tr) === cols);
        const head = [0, 1, 2, 3, 4, 7].every((i) => span(tbl.tHead.rows[i]) === cols);
        const cut = [...tbl.querySelectorAll('td')].filter((td) => td.textContent.trim() && td.scrollWidth > td.clientWidth + 0.5).map((td) => td.textContent.trim());
        const col = (td) => getComputedStyle(td).color;
        const coloured = [...tbl.querySelectorAll('td')].filter((td) => col(td) !== 'rgb(0, 0, 0)').map((td) => `${td.className}:${td.textContent}:${col(td)}`);
        const wheat = [...tbl.tBodies[0].rows].find((tr) => /^Wheat$/.test(tr.cells[1]?.textContent ?? ''));
        return { body, foot, head, cut, coloured, wheatShort: wheat ? col(wheat.cells[20]) : '' };
      }, S.PV_COLS);
      check('every commodity, section, note and footer row spans the same 38 columns as the headings', g.body && g.foot && g.head);
      check('no heading or figure is cut or spills into the next cell', !g.cut.length, g.cut.slice(0, 6).join(' | '));
      check('Shortage red and Excess green, the figure only', g.coloured.length > 0 && g.coloured.every((c) => /^short:15\.500:rgb\(220, 38, 38\)$|^short:1:rgb\(220, 38, 38\)$|^excess:10:rgb\(21, 128, 61\)$|^excess:1:rgb\(21, 128, 61\)$/.test(c)), g.coloured.filter((c) => !/15\.500|:10:|:1:/.test(c)).slice(0, 5).join(', '));
      check('…a zero stays black (Wheat\'s shortage 0)', g.wheatShort === 'rgb(0, 0, 0)', g.wheatShort);
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const d = await pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
      const pg = await d.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      const it = (await pg.getTextContent()).items.filter((i) => i.str?.trim());
      const PT = 25.4 / 72;
      const w = vp.width * PT, h = vp.height * PT;
      const x0 = Math.min(...it.map((i) => i.transform[4])) * PT, x1 = Math.max(...it.map((i) => i.transform[4] + i.width)) * PT;
      const text = it.map((i) => i.str).join(' ');
      check(`the PDF: ${d.numPages} page, ${w.toFixed(1)} × ${h.toFixed(1)} mm — Legal landscape, ONE page with every commodity on it`,
        d.numPages === 1 && Math.abs(w - 355.6) < 0.5 && Math.abs(h - 215.9) < 0.5);
      check(`…the sheet inside the margins on both sides (text ${x0.toFixed(1)} → ${x1.toFixed(1)} mm)`, x0 >= 18 && w - x1 >= 18);
      check('…with nothing of the app on it, and its rightmost headings and both signatures',
        !/SIDEBAR/.test(text) && /Excess/.test(text) && /\b18\b/.test(text) && /SIGNATURE OF BILL CLERK/.test(text) && /PHYSICAL VERIFICATION OFFICER/.test(text));
      await d.destroy();
    } finally {
      await browser.close();
    }
  }
}

// ── 6. Our own Page 2 as a PDF, and the office's OAP FRK row ─────────────
// (office, 2026-10-02 — CRS 20's July / August PDFs and the system's own
// September workbook were all refused on the 3-Month PV upload.)
console.log('\n6. Page 2 layouts the reader must know');
{
  // Our own printed Page 2: EXCESS / SHORT·AGE / TRANS·FER are headings with
  // NO BAGS / KGS leaf under them (their figure sits straight below), and two
  // of them break over two lines; the sheet ends with a summary box and a
  // signature line; SUGAR(AAY) is spelt "SUGAR AAY". It was refused as
  // "6 column headings but 5 sets of BAGS / KGS under them".
  const sys = (rows) => {
    const items = [
      at('TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION', 200, 20),
      at("Monthly report for the month of SEPTEMBER'2026", 240, 34),
      at('NAME OF THE B.C : SOMEONE', 60, 48), at('CRS NO: 23', 500, 48),
      at('OPENING', 125, 70), at('BALANCE', 126, 79),
      at('RECEIPT', 215, 74),
      at('EXCESS', 290, 79),
      at('SHORT', 330, 74), at('AGE', 334, 83),
      at('TRANS', 372, 74), at('FER', 376, 83),
      at('TOTAL', 440, 74),
      at('SALES', 560, 74),
      at('CLOSING', 690, 70), at('BALANCE', 689, 79),
      at('BAGS', 105, 90), at('KGS', 150, 90), at('BAGS', 195, 90), at('KGS', 240, 90),
      at('BAGS', 420, 90), at('KGS', 465, 90), at('BAGS', 510, 90), at('KGS', 555, 90), at('RATE', 600, 90), at('AMOUNT', 640, 90),
      at('BAGS', 680, 90), at('KGS', 725, 90),
    ];
    // right edges per field: a BAGS/KGS pair, or the one KGS cell under a leafless heading.
    const E = { open: [128, 173], receipt: [218, 263], excess: [318], shortage: [358], transfer: [400], total: [443, 488], sales: [533, 578], closing: [703, 748] };
    let y = 110;
    let sl = 1;
    for (const [label, v] of Object.entries(rows)) {
      items.push(at(String(sl++), 22, y), at(label, 40, y));
      for (const [f, val] of Object.entries(v)) {
        const pair = Array.isArray(val) ? val : [val];
        const e = E[f].length === 2 && pair.length === 1 ? [E[f][1]] : E[f];
        pair.forEach((n, i) => { if (n !== '' && n !== undefined) items.push(rightAt(n, e[i], y)); });
      }
      y += 14;
    }
    items.push(at('Sales Amount', 560, y + 10), rightAt('73275.41', 748, y + 10), at('TOTAL', 560, y + 24), rightAt('73490.51', 748, y + 24), at('EXCESS', 560, y + 38), rightAt('8.49', 748, y + 38));
    items.push(at('BILL CLERK : SOMEONE', 40, y + 70), at('AREA SUPERVISOR', 640, y + 70));
    return items;
  };
  const rows = sys({
    'B.RICE': { open: [47, 2316.998], receipt: [109, 5494], total: [156, 7810.998], sales: [114, 5706.998], closing: [42, 2104] },
    SUGAR: { open: [14, 695.996], receipt: [24, 1230], excess: 0.006, total: [38, 1926.002], sales: [25, 1253.502], closing: [13, 672.5] },
    'SUGAR AAY': { open: [0, 3], receipt: [0, 5], total: [0, 8], sales: [0, 5], closing: [0, 3] },
    'NPHH FRK RRA': { open: [0, 0.004], total: [0, 0.004], closing: [0, 0.004] },
    "PALM JAGGERY'S": {}, POLICE: {}, 'C.BOX': { sales: [71, ''], closing: [-71, ''] }, 'P.GUNNY': {},
  });
  const r = P.readPage2(rows);
  const f = (id) => { const x = r[id]; return [x.open, x.receipt, x.excess, x.total, x.sales, x.closing].join('/'); };
  check('the system\'s own Page 2 reads: headings with no leaf, split over two lines', !!r.BRA, J(Object.keys(r)));
  check('B.RICE 2316.998 / 5494 / 0 / 7810.998 / 5706.998 / 2104', f('BRA') === '2316.998/5494/0/7810.998/5706.998/2104', f('BRA'));
  check('SUGAR\'s EXCESS 0.006 lands in EXCESS, not in a bags column', f('SUGAR') === '695.996/1230/0.006/1926.002/1253.502/672.5', f('SUGAR'));
  check('"SUGAR AAY" is SUGAR(AAY)', r.AAY_SUGAR?.total === 8, J(r.AAY_SUGAR));
  check('the summary box and the signature line are not read as rows', !('TOTAL' in r) && !('EXCESS' in r) && Object.keys(r).length === 6, J(Object.keys(r)));

  // The office's July sheet carries stock on its OAP FRK line — a commodity
  // on the master — and was refused as "not a commodity this reader knows".
  const office = page2(20, 7, { 'B.RICE': { open: [10, 500], receipt: [0, 0], total: [10, 500], sales: [2, 100], closing: [8, 400] }, 'OAP FRK': { open: [0, 20], total: [0, 20], closing: [0, 20] }, 'APS FRK': {}, 'PONGAL GIFT': {} });
  const o = P.readPage2(office);
  check('OAP FRK reads as OAP_FRK: 20 / 0 / 20 / 0 / 20', !!o.OAP_FRK && [o.OAP_FRK.open, o.OAP_FRK.total, o.OAP_FRK.closing].join('/') === '20/20/20', J(o.OAP_FRK));
  check('APS FRK and PONGAL GIFT, printed empty, are stepped over', !('APS_FRK' in o) && Object.keys(o).length === 3, J(Object.keys(o)));
  const bad = refused(() => P.readPage2(page2(20, 7, { 'B.RICE': { open: [10, 500], total: [10, 500], closing: [10, 500] }, 'APS FRK': { open: [0, 5], total: [0, 5], closing: [0, 5] } })));
  check('a figure on a ruled-empty line (APS FRK) is refused, not dropped', !!bad && /"APS FRK" carries a figure/.test(bad), bad);
}


// ── 7. A TOTAL shown without decimals ────────────────────────────────────
// (office, 2026-10-03 — CRS 20 JULY'26 PHH FRK 4411.48 printed as 4411,
// NPHH FRK 4580.046 + transfer 20 as 4600; AUG'26 1.538 + 2500 as 2502.)
console.log('\n7. A Total the workbook shows rounded to the kilo');
{
  const read = (row) => P.readPage2(page2(20, 7, { 'B.RICE': { open: [1, 50], total: [1, 50], closing: [1, 50] }, 'PHH FRK': row }));
  const a = read({ open: [88, 4411.48], receipt: [0, 0], total: [88, 4411], sales: [88, 4409.942], closing: [0, 1.538] }).PHH_FRK;
  check(`4411.48 printed as 4411 → the exact 4411.48 (the row proves it: − 4409.942 = 1.538)`, a.total === 4411.48 && a.closing === 1.538, J(a));
  const b = read({ open: [0, 1.538], receipt: [50, 2500], total: [50, 2502], sales: [0, 1.538], closing: [50, 2500] }).PHH_FRK;
  check(`1.538 + 2500 printed as 2502 → 2501.538`, b.total === 2501.538, J(b));
  const c = read({ open: [91, 4580.046], transfer: 20, total: [91, 4600], sales: [90, 4579.874], closing: [1, 20.172] }).PHH_FRK;
  check(`with a transfer: 4580.046 + 20 printed as 4600 → 4600.046, transfer in`, c.total === 4600.046 && c.transfer === 20, J(c));
  const d = refused(() => read({ open: [88, 4411.48], total: [88, 4411], sales: [88, 4409.942], closing: [0, 1] }));
  check('still refused when the Closing does not follow from the exact sum', !!d && /does not add up/.test(d), d);
  const e = refused(() => read({ open: [88, 4411.48], total: [88, 4412], sales: [88, 4409.942], closing: [0, 2.058] }));
  check('still refused when the printed Total is not the sum rounded (4412 for 4411.48)', !!e && /does not add up/.test(e), e);
  const g = refused(() => read({ open: [88, 4411.48], total: [88, 4411.5], sales: [88, 4409.942], closing: [0, 1.558] }));
  check('a Total printed WITH decimals is taken as printed, and refused if wrong', !!g && /does not add up/.test(g), g);
}


// ── 8. This system's own statements PDF as an uploaded month ────────────
// (office, 2026-10-03 — CRS 20 September 2026: "Empty Polythene Bag: August
// closes at 40, but September opens at 0".)
console.log('\n8. Empty Card+Box / Polythene Bag on this system\'s own Page 2');
{
  const flow = (o) => ({ open: 0, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: 0, sales: 0, closing: 0, ...o });
  const gunny = { ss50: { opening: 874, receipt: 426, total: 1300, issues: 1000, closing: 300 }, poly: { opening: 40, receipt: 32, total: 72, issues: 72, closing: 0 }, cbox: { opening: 1, receipt: 108, total: 109, issues: 109, closing: 0 } };
  const ours = Q.pdfQuarterMonth({ crsId: 20, month: 9, year: 2026, rows: { BRA: flow({ open: 10, total: 10, closing: 10 }), EMPTY_BAG: flow({ sales: 72, closing: -72 }), EMPTY_BOX: flow({ sales: 109, closing: -109 }) }, gunny, police: null, notes: [], skipped: [] });
  check(`a sales-only row (0 − 72 = −72) takes the GUNNY sheet's POLY: ${J(ours.rows.EMPTY_BAG)}`, J({ ...ours.rows.EMPTY_BAG, bags: undefined }) === J(flow({ open: 40, receipt: 32, total: 72, sales: 72, closing: 0 })) && ours.rows.EMPTY_BAG.bags?.closing === 0);
  check(`…and C.BOX: 1 + 108 − 109 = 0`, ours.rows.EMPTY_BOX.open === 1 && ours.rows.EMPTY_BOX.closing === 0);
  const office = Q.pdfQuarterMonth({ crsId: 20, month: 8, year: 2026, rows: { EMPTY_BAG: flow({ open: 55, receipt: 31, total: 86, sales: 46, closing: 40 }) }, gunny: { ...gunny, poly: { opening: 9, receipt: 9, total: 18, issues: 9, closing: 9 } }, police: null, notes: [], skipped: [] });
  check('a row carrying stock of its own (the office\'s) is left as printed', office.rows.EMPTY_BAG.closing === 40 && office.rows.EMPTY_BAG.open === 55);
  const noGunny = Q.pdfQuarterMonth({ crsId: 20, month: 9, year: 2026, rows: { EMPTY_BAG: flow({ sales: 72, closing: -72 }) }, gunny: null, police: null, notes: [], skipped: [] });
  check('no GUNNY sheet uploaded: nothing to take, the row stays as printed', noGunny.rows.EMPTY_BAG.closing === -72);
}


// ── 9. The PV's bag columns are carried bags, never kgs ÷ pack ──────────
// (office, 2026-10-06 — CRS 20 PHH FRK closed at 3585 kg: Page 2 72 bags,
// the PV 71 = 3585 ÷ 50; the same for AAY FRK, AAY, Wheat, CYL.)
console.log('\n9. Bag counts: carried from Page 2, Closing = the latest month\'s');
{
  const bf = (open, receipt, sales, closing = open + receipt - sales) => ({ open, receipt, total: open + receipt, sales, closing });
  const p = Q.periodBags([bf(88, 0, 88), bf(0, 50, 0), bf(50, 40, 18)]);
  check(`chained months: Opening 88 + Receipt 90 = 178 − Issues 106 = Closing 72 (${J(p)})`, J(p) === J({ open: 88, receipt: 90, total: 178, issues: 106, closing: 72 }));
  const brk = Q.periodBags([bf(88, 0, 88), bf(0, 50, 0), bf(52, 40, 18)]); // September opens at 52 bags (typed), not August's 50
  check(`a broken carry: Closing stays September's 74 and Issues absorbs it (${brk.issues}); Receipt is never touched (${brk.receipt})`, brk.closing === 74 && brk.receipt === 90 && brk.total - brk.issues === brk.closing);
  check('a month with no bag counts → none for the period (kgs ÷ pack, as before)', Q.periodBags([bf(1, 1, 1), undefined]) === undefined);
  const html = S.buildPVTable({ commMap: { PHH_FRK: { name: 'PHH FRK Rice', unit: 'KG', open: 4411.48, receipt: 4500, total: 8911.48, issues: 5326.48, closing: 3585, amount: 0, free: true, bags: p } }, periodLabel: 'Q', crsId: 20, crsName: '', gunny: {}, staff: {}, pvOfficer: '', pvDate: '' });
  const row = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim())).find((c) => c.includes('PHH FRK Rice'));
  check(`the PV prints the carried bags: 88 · 90 · 178 · 106 · 72 with the kgs untouched (${row?.filter(Boolean).join(' ')})`, !!row && ['88', '4411.480', '90', '4500', '178', '8911.480', '106', '5326.480', '72', '3585'].every((v) => row.includes(v)) && !row.includes('71'));
  // Bags read off an uploaded PAGE2
  const pg = P.readPage2(page2(20, 9, { 'PHH FRK': { open: [50, 2500], receipt: [40, 2000], total: [90, 4500], sales: [18, 915], closing: [72, 3585] }, 'P.GUNNY': { open: [40, ''], receipt: [32, ''], total: [72, ''], sales: [72, ''], closing: [0, ''] } }));
  check(`an uploaded PAGE2's printed BAGS are read: ${J(pg.PHH_FRK.bags)}`, J(pg.PHH_FRK.bags) === J({ open: 50, receipt: 40, total: 90, sales: 18, closing: 72 }));
  check('a pieces row (P.GUNNY) is its own count', pg.EMPTY_BAG.bags?.closing === 0 && pg.EMPTY_BAG.bags?.open === 40);
}


// ── 10. No Empty Card+Box / Polythene Bag commodity rows; the NOTE row ────
// (office, 2026-10-06.)
console.log('\n10. The PV\'s commodity rows and its NOTE row');
{
  const row = (name, unit = 'KG') => ({ name, unit, open: 1, receipt: 0, total: 1, issues: 0, closing: 1, amount: 0, free: true });
  const commMap = { BRA: row('BRA Rice'), TAN: row('TAN', 'PKT'), EMPTY_BOX: row('Empty Card+Box', 'NOS'), EMPTY_BAG: row('Empty Polythene Bag', 'NOS'), PB_BRA: row('BRA Rice (Police)') };
  const gunny = { ss50: { opening: 1, receipt: 0, total: 1, issues: 0, closing: 1 }, poly: { opening: 33, receipt: 95, total: 128, issues: 128, closing: 0 }, cbox: { opening: 66, receipt: 324, total: 390, issues: 390, closing: 0 } };
  const html = S.buildPVTable({ commMap, periodLabel: 'Q', crsId: 20, crsName: '', gunny, staff: {}, note: 'Stack 4 re-counted on site.\nWheat consider as gunny <ok>' });
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
  const named = (n) => rows.find((c) => c[1] === n);
  check('Empty Card+Box and Empty Polythene Bag are not commodity rows', !named('Empty Card+Box') && !named('Empty Polythene Bag'));
  check('…their stock still prints in the Gunny section (POLYTHENE 33 / 95 / 128, C.BOX 66 / 324 / 390)', /POLYTHENE/.test(html) && ['33', '95', '128'].every((v) => named('POLYTHENE')?.includes(v)) && ['66', '324', '390'].every((v) => named('C.BOX')?.includes(v)));
  const sls = rows.filter((c) => /^\d+$/.test(c[0]) && c.length > 20).map((c) => Number(c[0]));
  check(`numbering runs on with no gap: ${sls.join(', ')}`, sls.every((n, i) => n === i + 1));
  const noteTd = html.match(/<tr class="pv-note"><td colspan="(\d+)" class="l f note">([\s\S]*?)<\/td><\/tr>/);
  check(`the NOTE row is one cell across all ${S.PV_COLS} columns`, !!noteTd && Number(noteTd[1]) === S.PV_COLS);
  check('"NOTE:" bold, then the note, its lines kept, its text escaped', /^<b>NOTE:<\/b> <span class="note-text">Stack 4 re-counted on site\.<br>Wheat consider as gunny &lt;ok&gt;<\/span>$/.test(noteTd?.[2] ?? ''), noteTd?.[2]);
  check('the NOTE cell wraps, sits at the top and has room for about four lines', /td\.note\{white-space:normal;vertical-align:top;height:15mm;/.test(html));
  const blank = S.buildPVTable({ commMap, periodLabel: 'Q', crsId: 20, crsName: '', gunny, staff: {} });
  check('no note typed → "NOTE:" alone, the space left for a hand-written note', /<td colspan="\d+" class="l f note"><b>NOTE:<\/b><\/td>/.test(blank));
  const both = S.buildPVTable({ commMap, periodLabel: 'Q', crsId: 20, crsName: '', gunny, staff: {}, gunnyNotes: ['WHEAT CONSIDER AS GUNNY'], note: 'wheat consider as gunny\nStack 4 re-counted.' });
  check('Gunny\'s note and a typed note share the NOTE row: Gunny\'s first, a repeat dropped', /<b>NOTE:<\/b> <span class="note-text">WHEAT CONSIDER AS GUNNY<br>Stack 4 re-counted\.<\/span>/.test(both) && (both.match(/consider as gunny/gi) ?? []).length === 1);
  check('the Gunny section ends at C.BOX: no note row inside it', !/pv-gunny-note/.test(both) && /C\.BOX[\s\S]*?<\/tr>(<tr><td colspan="\d+" class="l sec">Police|<\/tbody>)/.test(both));
}

// ─── 11. The PV names the shop's own BC and Packer (office, 2026-10-06) ─────
{
  console.log("\n§11  NAME OF THE BILL CLERK / P.K.R — the selected shop's staff, never the signed-in user");
  const A = await imp('src/lib/engine/staffAssignment.ts');
  const u = (id, fullName, role, crsId, active = true) => ({ id, fullName, username: 'crs' + crsId, phone: '', role, crsId, active });
  const roster = [
    u(1, 'Administrator', 'ADMIN', null),
    u(2, 'Saravanan', 'BC', 23), u(3, 'RamaMoorthy', 'Packer', 23),
    u(4, 'Anand', 'Packer', 8),
    u(5, 'Old Clerk', 'BC', 8, false),
    u(6, 'Kumar', 'BC', 9),
  ];
  const at = (crsId) => S.buildPVTable({ commMap: {}, periodLabel: 'Q', crsId, crsName: '', gunny: {}, staff: A.shopStaffNames(roster, crsId) });
  const head = (h) => (h.match(/<tr><td colspan="21" class="l t2">((?:(?!<\/td>).)*NAME OF THE (?:BILL CLERK|P\.K\.R)(?:(?!<\/td>).)*)<\/td>/) ?? [])[1] ?? '';
  const sig = (h) => (h.match(/SIGNATURE OF ([A-Z. ]+?) WITH SEAL/) ?? [])[1];
  const h23 = at(23), h8 = at(8), h9 = at(9), h4 = at(4);
  check('CRS 23, both posts: BILL CLERK Saravanan, then P.K.R RamaMoorthy', head(h23) === '<b>NAME OF THE BILL CLERK :</b> Saravanan<br><b>NAME OF THE P.K.R :</b> RamaMoorthy', head(h23));
  check('CRS 8, a Packer only (its inactive BC left out): the P.K.R line alone, signed by the P.K.R', head(h8) === '<b>NAME OF THE P.K.R :</b> Anand' && sig(h8) === 'P.K.R', head(h8));
  check('CRS 9, a Bill Clerk only: the BILL CLERK line alone', head(h9) === '<b>NAME OF THE BILL CLERK :</b> Kumar' && sig(h9) === 'BILL CLERK', head(h9));
  check('CRS 4, nobody assigned: the Bill Clerk line with its ruled blank', head(h4) === '<b>NAME OF THE BILL CLERK :</b> ____________', head(h4));
  check("no shop's PV names the administrator or another shop's staff", ![h23, h8, h9, h4].some((h) => /Administrator/.test(h)) && !/Anand|Kumar/.test(h23) && !/Saravanan|Kumar/.test(h8));
  roster[1].role = 'Packer'; roster[2].role = 'BC';
  check('a role swapped on the Users screen swaps the lines on the next build', head(at(23)) === '<b>NAME OF THE BILL CLERK :</b> RamaMoorthy<br><b>NAME OF THE P.K.R :</b> Saravanan');
  check('a name is escaped', /NAME OF THE BILL CLERK :<\/b> A &amp; B/.test(S.buildPVTable({ commMap: {}, periodLabel: 'Q', crsId: 1, crsName: '', gunny: {}, staff: { bc: 'A & B' } })));
}


console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
