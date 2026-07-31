/**
 * Imports the office's monthly CRS workbooks into the database.
 *
 *   node tools/import-monthly-xlsx.mjs "C:/path/to/folder" --dry-run
 *   node tools/import-monthly-xlsx.mjs "C:/path/to/folder" --write
 *
 * One workbook per shop per month. Only the INPUT sheets are read — the
 * statement pages (FREE COM, COST COM, B6, RBI, RW, PONGAL, JAGGERY, sale tax)
 * are outputs the engine computes from these inputs, so importing them would
 * create a second, competing version of numbers the app already derives.
 *
 * Where each sheet lands:
 *   CRS PAGE2 - 2    -> monthlyStore / meManualStore  section 'a'
 *   CRS POLICE       -> monthlyStore / meManualStore  section 'b'
 *   GUNNY-2          -> meGunnyStore
 *   CARD DETAIL - 2  -> meCardStore
 *   REMITTANCE - 2   -> meRemitStore
 *
 * Written to meManualStore as well as monthlyStore on purpose: monthlyStore is
 * REBUILT by meRecompute() from the daily rollup plus meManualStore, so data
 * written only to monthlyStore is discarded the first time a user opens Monthly
 * Entry. meManualStore is what survives, and meSourceStore marks each figure
 * 'manual' so the screen shows it as an entered value rather than a derived one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

// ── Commodity mapping ───────────────────────────────────────────────────────
// Sheet labels are the office's, the ids are DSS_A / DSS_B in src/legacy.
const SECTION_A = {
  'B.RICE': 'BRA',
  'A.A.Y': 'AAY',
  'R.R.A': 'RRA',
  SUGAR: 'SUGAR',
  'SUGAR(AAY)': 'AAY_SUGAR',
  WHEAT: 'WHEAT',
  'T.DHALL/CYL': 'TOOR',
  'P.OIL': 'PALM',
  OOTY: 'OOTY',
  TAN: 'TAN',
  'SALT(CIS)': 'SALT_CIS',
  'SALT(RFFS)': 'SALT_RFFS',
  'PHH BRA': 'PHH_BRA',
  'PHH FRK': 'PHH_FRK',
  'AAY FRK': 'AAY_FRK',
  'NPHH FRK': 'NPHH_FRK',
  'NPHH FRK RRA': 'NPHH_RRA',
  // Spelling variants seen across the 22 workbooks for the same commodity.
  'T.DHALL': 'TOOR',
  'T.DHALL / CYL': 'TOOR',
  'T.DHALL/ CYL': 'TOOR',
  'T.DHALL /CYL': 'TOOR',
  'NPHH RRA': 'NPHH_RRA',
  OAP: 'OAP',
  APS: 'APS',
  // Confirmed by the office, 29 Jul 2026:
  //   CYL is their label for T.DHALL — the sheets carrying it have no separate
  //   T.DHALL row. FRK AAY is the same commodity as AAY FRK. The fortified
  //   OAP/ANP rows are counted under OAP and APS rather than kept apart.
  CYL: 'TOOR',
  'FRK AAY': 'AAY_FRK',
  'OAP FRK': 'OAP',
  'FRK OAP': 'OAP',
  'FRK ANP': 'APS',
  ANP: 'APS',
};

/**
 * Labels with no home in DSS_A that have been empty in every workbook seen so
 * far. Silently ignored while they stay at zero, and reported the moment one
 * carries a figure — so a new commodity appearing next month is noticed rather
 * than quietly dropped from a statutory return.
 */
const TOLERATE_IF_ZERO = new Set(['PHH RRA']);
// Subtotals and rows handled by other sheets — skipped, not unmapped.
const SECTION_A_SKIP = new Set([
  'RICE TOTAL', 'TOTAL', 'G.TOTAL', 'POLICE', 'C.BOX', 'P.GUNNY',
  'JAGGERY', 'GRAND TOTAL', 'CARD DETAILS', 'COMMODITY',
  // The jaggery/palm row is carried by its own sheet, not the proforma.
  "PALM JAGGERY'S", 'PALM JAGGERYS', 'PALM JAGGERY', "PLAM JAGGERY'S", 'PLAM JAGGERYS',
]);

const SECTION_B = {
  'B.R.A': 'PB_BRA',
  SUGAR: 'PB_SUGAR',
  WHEAT: 'PB_WHEAT',
  'T.DHALL': 'PB_TOOR',
  'P.OIL': 'PB_PALM',
};

const CARD_TYPES = {
  'RICE CARD': 'rice',
  'LOF RICE CARD': 'lof_rice',
  'SUGAR CARD': 'sugar',
  'LOF SUGAR': 'lof_sugar',
  'LOF SUGAR CARD': 'lof_sugar',
  'AAY CARD': 'aay',
  'LOF AAY CARD': 'lof_aay',
  OAP: 'oap',
  POLICE: 'police',
  'POLICE CARD': 'police',
  '"N" CARD': 'n_card',
  "N'CARD": 'n_card',
  'N CARD': 'n_card',
};

const GUNNY_ITEMS = {
  '50KG SS': 'ss50', '50 KG SS': 'ss50',
  POLY: 'poly', POLYTHENE: 'poly',
  'C. BOX': 'cbox', 'C.BOX': 'cbox', 'CARDBOARD.BOX': 'cbox',
};

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
// Header names compared with punctuation/spacing stripped: "C.S" ≡ "CS",
// "NON - CEREAL ACCOUNT" ≡ "NONCEREALACCOUNT".
const gkey = (v) => norm(v).replace(/[^A-Z0-9]/g, '');
const num = (v) => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// ── Header-driven column resolution ─────────────────────────────────────────
// The 22 workbooks carry 13 different column layouts on the proforma alone —
// offices insert SHORTAGE / EXCESS / TRANSFER / C.S columns in different spots,
// and each insertion shifts everything after it. Columns are therefore located
// by NAME from the two header rows (group row + BAGS/KGS sub-row), never by
// position. Group cells span merged columns, so a group name carries forward
// until the next named one: OPENING BALANCE + (BAGS, KGS) -> keys
// 'OPENINGBALANCE|BAGS' and 'OPENINGBALANCE|KGS'.
function headerMap(rows, headerIdx) {
  const groups = rows[headerIdx] || [];
  const subs = rows[headerIdx + 1] || [];
  const map = {};
  let g = '';
  for (let i = 0; i < Math.max(groups.length, subs.length); i++) {
    if (gkey(groups[i])) g = gkey(groups[i]);
    let s = gkey(subs[i]);
    if (s === 'BAG') s = 'BAGS'; // CRS 20 labels one TRANSFER sub-column "BAG"
    const k = `${g}|${s}`;
    if (!(k in map)) map[k] = i;
  }
  return map;
}
const pickCol = (map, ...keys) => { for (const k of keys) if (k in map) return map[k]; return -1; };
// RATE/AMOUNT live only in the sub-row, under whatever group happens to
// precede them — match on the sub-name alone.
const pickSub = (map, sub) => { const k = Object.keys(map).find((x) => x.endsWith('|' + sub)); return k ? map[k] : -1; };
const cell = (r, i) => (i >= 0 && r ? r[i] : null);
/**
 * Sheet names are not consistent between workbooks — the same page appears as
 * "CRS PAGE2", "CRS PAGE2 " and "CRS PAGE2 - 2", gunny as "GUNNY-2", "GUNNY 2"
 * and "GUNNY". Match on the name with punctuation and spacing removed, by
 * prefix, so the "- 2" suffix some offices append does not hide the sheet.
 */
function findSheet(wb, prefix) {
  const want = prefix.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return wb.SheetNames.find((n) => n.replace(/[^A-Z0-9]/gi, '').toUpperCase().startsWith(want)) || null;
}

const rowsOf = (wb, prefix) => {
  const name = findSheet(wb, prefix);
  return name
    ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false })
    : [];
};

/**
 * "…FOR THE MONTH OF JUNE'2026" -> {month:6, year:2026}
 *
 * Only ever called on title text. Passing it a column of Date objects looked
 * harmless but String(date) renders as "Sat May 31 2026 …", so every June
 * workbook was read as May.
 */
function periodFrom(text) {
  const t = norm(text);
  const m = MONTHS.findIndex((name) => t.includes(name));
  if (m < 0) return null;
  const full = t.match(/(20\d{2})/);          // JUNE'2026
  const short = t.match(/'\s*(\d{2})\b/);     // JUNE'26
  if (!full && !short) return null;
  return { month: m + 1, year: full ? Number(full[1]) : 2000 + Number(short[1]) };
}

/** The first few rows of a sheet, which is where the office puts the title. */
const titleOf = (rows) => rows.slice(0, 4).map((r) => (r || []).filter((c) => typeof c === 'string').join(' ')).join(' ');

function parseWorkbook(path) {
  const wb = XLSX.readFile(path, { cellDates: true });
  const file = basename(path);

  const crsMatch = file.match(/CRS\s*(\d+)/i);
  if (!crsMatch) return { file, error: 'no CRS number in filename' };
  const crsId = Number(crsMatch[1]);

  const page2 = rowsOf(wb, 'CRS PAGE2');
  const period =
    periodFrom(titleOf(page2)) ||
    periodFrom(titleOf(rowsOf(wb, 'CRS DAILY SALE'))) ||
    periodFrom(titleOf(rowsOf(wb, 'CRS PAGE1'))) ||
    periodFrom(file);
  if (!period) return { file, crsId, error: 'could not determine month/year' };

  // CRS 29 (refugee camp) differs from every other shop: KEROSENE is a real
  // commodity there (id KERO, carried by its own entry screens), and its CYL
  // row is gas cylinders — allotment only, never stock. Everywhere else CYL is
  // the office's label for T.DHALL, so the override is per-shop.
  const secAMap = { ...SECTION_A };
  const secASkip = new Set(SECTION_A_SKIP);
  if (crsId === 29) {
    secAMap.KEROSENE = 'KERO';
    delete secAMap.CYL;
    secASkip.add('CYL');
  }

  const key = `${crsId}_${period.month}_${period.year}`;
  const out = {
    file, crsId, key, period,
    monthly: { a: {}, b: {} },
    gunny: {}, cards: {}, remit: {},
    unmapped: [], notes: [],
  };

  // ── Section A: the monthly proforma ───────────────────────────────────────
  // Columns are resolved from the header rows by name (see headerMap). The
  // adjustment columns (SHORTAGE / EXCESS / TRANSFER) and the C.S column
  // ("cumulative shortage" — carried by CRS 10, 26 and 29 only) exist in some
  // workbooks and not others; where absent the field imports as 0.
  const headerRow = page2.findIndex((r) => (r || []).some((c) => norm(c) === 'COMMODITY'));
  let cols;
  if (headerRow >= 0) {
    const m = headerMap(page2, headerRow);
    cols = {
      label: pickCol(m, 'COMMODITY|'),
      g_open: pickCol(m, 'OPENINGBALANCE|BAGS'), open: pickCol(m, 'OPENINGBALANCE|KGS'),
      g_receipt: pickCol(m, 'RECEIPT|BAGS'), receipt: pickCol(m, 'RECEIPT|KGS'),
      excess: pickCol(m, 'EXCESS|KGS', 'EXCESS|'),
      shortage: pickCol(m, 'SHORTAGE|KGS', 'SHORTAGE|'),
      transfer: pickCol(m, 'TRANSFER|KGS', 'TRANSFER|'),
      g_total: pickCol(m, 'TOTAL|BAGS'), total: pickCol(m, 'TOTAL|KGS'),
      g_sales: pickCol(m, 'SALES|BAGS'), sales: pickCol(m, 'SALES|KGS'),
      rate: pickSub(m, 'RATE'), amount: pickSub(m, 'AMOUNT'),
      g_cs: pickCol(m, 'CS|BAGS'), cs: pickCol(m, 'CS|KGS', 'CS|'),
      g_close: pickCol(m, 'CLOSINGBALANCE|BAGS'), close: pickCol(m, 'CLOSINGBALANCE|KGS'),
    };
    if (cols.open < 0 || cols.sales < 0 || cols.close < 0) {
      out.notes.push('proforma header found but key columns missing — check sheet');
    }
  } else {
    // No recognisable header: fall back to the most common layout.
    out.notes.push('no COMMODITY header — assumed default layout');
    cols = {
      label: 1, g_open: 2, open: 3, g_receipt: 4, receipt: 5,
      excess: -1, shortage: -1, transfer: 6,
      g_total: 7, total: 8, g_sales: 9, sales: 10, rate: 11, amount: 12,
      g_cs: -1, cs: -1, g_close: 13, close: 14,
    };
  }
  const firstDataRow = headerRow >= 0 ? headerRow + 2 : 5;

  for (const r of page2.slice(firstDataRow)) {
    const label = norm(cell(r || [], cols.label));
    if (!label || secASkip.has(label)) continue;
    const id = secAMap[label];
    if (!id) {
      const figures = [cols.open, cols.receipt, cols.total, cols.sales, cols.close].map((i) => num(cell(r, i)));
      if (TOLERATE_IF_ZERO.has(label) && figures.every((v) => v === 0)) continue;
      out.unmapped.push(`A:${label}${figures.some((v) => v !== 0) ? ' (HAS FIGURES)' : ''}`);
      continue;
    }
    const rec = {
      open: num(cell(r, cols.open)), receipt: num(cell(r, cols.receipt)), total: num(cell(r, cols.total)),
      sales: num(cell(r, cols.sales)), close: num(cell(r, cols.close)), amount: num(cell(r, cols.amount)),
      excess: num(cell(r, cols.excess)), shortage: num(cell(r, cols.shortage)), transfer: num(cell(r, cols.transfer)),
      cs: num(cell(r, cols.cs)), g_cs: num(cell(r, cols.g_cs)),
      g_open: num(cell(r, cols.g_open)), g_receipt: num(cell(r, cols.g_receipt)), g_total: num(cell(r, cols.g_total)),
      g_sales: num(cell(r, cols.g_sales)), g_close: num(cell(r, cols.g_close)),
    };
    if (Object.values(rec).some((v) => v !== 0)) out.monthly.a[id] = rec;
  }

  // ── Section B: police ration ──────────────────────────────────────────────
  // Single header row: SI NO | COMMODITY | O.B | RECEIPT | TOTAL | SALES |
  // RATE | AMOUNT | C.B — matched by name; no bag columns on this sheet.
  const bRows = rowsOf(wb, 'CRSPOLICE');
  const bHdrIdx = bRows.findIndex((r) => (r || []).some((c) => norm(c) === 'COMMODITY'));
  const bHdr = bHdrIdx >= 0 ? bRows[bHdrIdx].map(gkey) : [];
  const bc = (name, fallback) => { const i = bHdr.indexOf(name); return i >= 0 ? i : fallback; };
  const bCols = bHdrIdx >= 0
    ? { label: bc('COMMODITY', 1), open: bc('OB', 2), receipt: bc('RECEIPT', 3), total: bc('TOTAL', 4),
        sales: bc('SALES', 5), amount: bc('AMOUNT', 7), close: bc('CB', 8) }
    : { label: 1, open: 2, receipt: 3, total: 4, sales: 5, amount: 7, close: 8 };
  for (const r of bRows.slice(bHdrIdx >= 0 ? bHdrIdx + 1 : 4)) {
    const label = norm(cell(r, bCols.label));
    if (!label || SECTION_A_SKIP.has(label)) continue;
    const id = SECTION_B[label];
    if (!id) { out.unmapped.push(`B:${label}`); continue; }
    const rec = {
      open: num(cell(r, bCols.open)), receipt: num(cell(r, bCols.receipt)), total: num(cell(r, bCols.total)),
      sales: num(cell(r, bCols.sales)), close: num(cell(r, bCols.close)), amount: num(cell(r, bCols.amount)),
      excess: 0, shortage: 0, transfer: 0, cs: 0, g_cs: 0,
      g_open: 0, g_receipt: 0, g_total: 0, g_sales: 0, g_close: 0,
    };
    if (Object.values(rec).some((v) => v !== 0)) out.monthly.b[id] = rec;
  }

  // ── Gunny stock ───────────────────────────────────────────────────────────
  // Two-row header: VARIETY over group columns each split GUNNY WITH GRAINS /
  // EMPTY GUNNY. The app tracks the EMPTY GUNNY figures (the office leaves
  // "with grains" blank), so each field resolves to its group's EMPTY column.
  const gRows = rowsOf(wb, 'GUNNY');
  const gHdrIdx = gRows.findIndex((r) => (r || []).some((c) => norm(c) === 'VARIETY'));
  const gCols = gHdrIdx >= 0
    ? (() => {
        const m = headerMap(gRows, gHdrIdx);
        return {
          label: pickCol(m, 'VARIETY|'),
          opening: pickCol(m, 'OPENINGBALANCE|EMPTYGUNNY'), receipt: pickCol(m, 'RECEIPT|EMPTYGUNNY'),
          total: pickCol(m, 'TOTAL|EMPTYGUNNY'), issues: pickCol(m, 'ISSUES|EMPTYGUNNY'),
          closing: pickCol(m, 'CLOSINGBALANCE|EMPTYGUNNY'),
        };
      })()
    : { label: 0, opening: 2, receipt: 4, total: 6, issues: 8, closing: 10 };
  for (const r of gRows.slice(gHdrIdx >= 0 ? gHdrIdx + 2 : 5)) {
    const id = GUNNY_ITEMS[norm(cell(r, gCols.label))];
    if (!id) { if (norm(cell(r, gCols.label))) out.unmapped.push(`GUNNY:${norm(cell(r, gCols.label))}`); continue; }
    out.gunny[id] = {
      itemName: norm(cell(r, gCols.label)), crsId: String(crsId), month: period.month, year: period.year,
      opening: num(cell(r, gCols.opening)), receipt: num(cell(r, gCols.receipt)), total: num(cell(r, gCols.total)),
      issues: num(cell(r, gCols.issues)), closing: num(cell(r, gCols.closing)),
      // The office's receipt figure. Monthly Entry's "Rule 2" normally
      // recomputes Receipt from the grid's gunny-sales counts on every render;
      // this field tells it the month was imported so the workbook figure is
      // kept (see buildMeGunnyTable / meGunnyRefreshReceipts).
      receiptImported: num(cell(r, gCols.receipt)),
    };
  }

  // ── Card details ──────────────────────────────────────────────────────────
  // Same column-shift problem as the proforma — CRS 9 carries a leading blank
  // column, which put the labels one across and read every count as blank.
  // Anchor on the "CARD DETAILS" header cell instead of a fixed index.
  const cardRows = rowsOf(wb, 'CARDDETAIL');
  const cHdr = cardRows.findIndex(
    (r) => (r || []).some((c) => norm(c) === 'CARD DETAILS') && (r || []).some((c) => gkey(c) === 'SNO'),
  );
  const labelCol = cHdr >= 0 ? cardRows[cHdr].findIndex((c) => norm(c) === 'CARD DETAILS') : 1;
  // The count sits under the "CARD" header (always next to CARD DETAILS so far,
  // but matched by name in case a workbook slips a column in between).
  const countCol = cHdr >= 0 ? cardRows[cHdr].findIndex((c) => gkey(c) === 'CARD') : -1;
  for (const r of cardRows.slice(cHdr >= 0 ? cHdr + 1 : 4)) {
    const id = CARD_TYPES[norm(r?.[labelCol])];
    if (!id) continue;
    out.cards[id] = { count: num(r[countCol >= 0 ? countCol : labelCol + 1]) };
  }

  // ── Remittance ────────────────────────────────────────────────────────────
  // Keyed by day of the SALES date, matching meRemitStore's {day: {...}} shape.
  // Header: SL NO | DATE OF SALES | DATE OF REMITTANCE | NON - CEREAL ACCOUNT
  // | [CEREAL ACCOUNT] | TOTAL — the CEREAL column exists in ~half the
  // workbooks and is imported where present (the app's remittance table and
  // statements carry a Cereal A/C column).
  const rRows = rowsOf(wb, 'REMITTANCE');
  const rHdrIdx = rRows.findIndex((r) => (r || []).some((c) => gkey(c) === 'DATEOFSALES'));
  const rHdr = rHdrIdx >= 0 ? rRows[rHdrIdx].map(gkey) : [];
  const rc = (name, fallback) => { const i = rHdr.indexOf(name); return i >= 0 ? i : fallback; };
  const rCols = rHdrIdx >= 0
    ? { sale: rc('DATEOFSALES', 1), remitDate: rc('DATEOFREMITTANCE', 2),
        nonCereal: rc('NONCEREALACCOUNT', 3), cereal: rHdr.indexOf('CEREALACCOUNT') }
    : { sale: 1, remitDate: 2, nonCereal: 3, cereal: -1 };
  for (const r of rRows.slice(rHdrIdx >= 0 ? rHdrIdx + 1 : 3)) {
    const d = cell(r, rCols.sale);
    if (!(d instanceof Date)) continue;
    const day = new Date(d.getTime() + 6 * 3600 * 1000).getUTCDate(); // sheet dates carry an IST offset
    const nonCereal = num(cell(r, rCols.nonCereal));
    const cereal = num(cell(r, rCols.cereal));
    if (!nonCereal && !cereal) continue;
    out.remit[day] = { remitDate: String(cell(r, rCols.remitDate) ?? ''), nonCereal, cereal };
  }

  const aN = Object.keys(out.monthly.a).length, bN = Object.keys(out.monthly.b).length;
  if (!aN && !bN) out.notes.push('no commodity rows found');
  // Surface the adjustment figures in the dry-run report so a shifted layout
  // that lands numbers in the wrong bucket is visible before anything writes.
  const adj = [];
  for (const [id, rec] of Object.entries(out.monthly.a)) {
    for (const f of ['shortage', 'excess', 'transfer', 'cs']) {
      if (rec[f]) adj.push(`${id} ${f}=${rec[f]}`);
    }
  }
  if (adj.length) out.notes.push(`adjustments: ${adj.join(', ')}`);
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────
const [, , dirArg, ...flags] = process.argv;
const WRITE = flags.includes('--write');
if (!dirArg) {
  console.error('usage: node tools/import-monthly-xlsx.mjs <folder> [--write]');
  process.exit(1);
}

const files = readdirSync(dirArg)
  .filter((f) => /^CRS[\s_-]*\d+.*\.xlsx$/i.test(f) && !f.startsWith('~$'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

console.log(`${files.length} workbook(s) in ${dirArg}\n`);

const parsed = [];
for (const f of files) {
  try {
    parsed.push(parseWorkbook(join(dirArg, f)));
  } catch (e) {
    parsed.push({ file: f, error: e.message });
  }
}

// One import is one month. A folder can hold a superseded file for the same
// shop (CRS 12 exists as both JUNE'25 and JUNE'26), and importing both would
// write two periods and leave the wrong one on screen. Take the period given on
// the command line, or the one most of the workbooks agree on, and set the rest
// aside by name so nothing is dropped silently.
const periodFlag = (flags.find((f) => f.startsWith('--period=')) || '').split('=')[1];
const skipIds = new Set(
  (flags.find((f) => f.startsWith('--skip=')) || '').split('=')[1]?.split(',').map(Number).filter(Boolean) ?? [],
);

const parsedOk = parsed.filter((p) => !p.error);
const tally = {};
for (const p of parsedOk) {
  const k = `${p.period.month}/${p.period.year}`;
  tally[k] = (tally[k] || 0) + 1;
}
const target = periodFlag || Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];

const ok = parsedOk.filter((p) => {
  const k = `${p.period.month}/${p.period.year}`;
  if (k !== target) { p.excluded = `period ${k}, importing ${target}`; return false; }
  if (skipIds.has(p.crsId)) { p.excluded = 'skipped by request'; return false; }
  return true;
});
const excluded = parsedOk.filter((p) => p.excluded);
const bad = parsed.filter((p) => p.error);

console.log('shop  period    key            sec-A  sec-B  gunny  cards  remit  notes');
console.log('----  --------  -------------  -----  -----  -----  -----  -----  -----');
for (const p of ok) {
  const per = `${String(p.period.month).padStart(2, '0')}/${p.period.year}`;
  console.log(
    String(p.crsId).padEnd(4),
    per.padEnd(8),
    p.key.padEnd(13),
    String(Object.keys(p.monthly.a).length).padStart(5),
    String(Object.keys(p.monthly.b).length).padStart(6),
    String(Object.keys(p.gunny).length).padStart(6),
    String(Object.keys(p.cards).length).padStart(6),
    String(Object.keys(p.remit).length).padStart(6),
    ' ' + [...new Set([...p.unmapped, ...p.notes])].join(', '),
  );
}
for (const p of excluded) console.log(`EXCL  ${p.file}: ${p.excluded}`);
for (const p of bad) console.log(`FAIL  ${p.file}: ${p.error}`);

console.log(`\nimporting period ${target} — ${ok.length} shop(s)`);
const flagged = ok.flatMap((p) => p.unmapped.filter((u) => u.includes('HAS FIGURES')).map((u) => `CRS ${p.crsId} ${u}`));
if (flagged.length) console.log(`!! unmapped rows carrying figures:\n   ${flagged.join('\n   ')}`);

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Re-run with --write to store.');
  process.exit(0);
}

// ── Write ───────────────────────────────────────────────────────────────────
readFileSync('.env.local', 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Merge new keys into a crs_state store row, guarded by its version. */
async function mergeStore(storeKey, additions) {
  if (!Object.keys(additions).length) return 'nothing to add';
  const cur = await db.from('crs_state').select('data,version').eq('scope', 'global').eq('store_key', storeKey).maybeSingle();
  if (cur.error) return `read failed: ${cur.error.message}`;

  const base = cur.data?.data && typeof cur.data.data === 'object' ? cur.data.data : {};
  const next = { ...base, ...additions };

  if (!cur.data) {
    const ins = await db.from('crs_state').insert({ scope: 'global', store_key: storeKey, data: next, version: 1, updated_by: 'import:xlsx' }).select('version').maybeSingle();
    return ins.error ? `insert failed: ${ins.error.message}` : `created v1 (+${Object.keys(additions).length})`;
  }
  const upd = await db.from('crs_state')
    .update({ data: next, version: cur.data.version + 1, updated_at: new Date().toISOString(), updated_by: 'import:xlsx' })
    .eq('scope', 'global').eq('store_key', storeKey).eq('version', cur.data.version)
    .select('version').maybeSingle();
  return upd.error || !upd.data ? 'conflict — reload and retry' : `v${upd.data.version} (+${Object.keys(additions).length})`;
}

const monthly = {}, manual = {}, source = {}, gunny = {}, cards = {}, remit = {};
for (const p of ok) {
  monthly[p.key] = p.monthly;
  manual[p.key] = p.monthly;
  source[p.key] = {
    a: Object.fromEntries(Object.keys(p.monthly.a).map((k) => [k, 'manual'])),
    b: Object.fromEntries(Object.keys(p.monthly.b).map((k) => [k, 'manual'])),
  };
  if (Object.keys(p.gunny).length) gunny[p.key] = p.gunny;
  if (Object.keys(p.cards).length) cards[p.key] = p.cards;
  if (Object.keys(p.remit).length) remit[p.key] = p.remit;
}

console.log('\nwriting…');
for (const [store, additions] of [
  ['monthlyStore', monthly], ['meManualStore', manual], ['meSourceStore', source],
  ['meGunnyStore', gunny], ['meCardStore', cards], ['meRemitStore', remit],
]) {
  console.log(' ', store.padEnd(15), await mergeStore(store, additions));
}
console.log('\ndone.');
