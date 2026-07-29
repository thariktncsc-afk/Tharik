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
const num = (v) => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
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

  const key = `${crsId}_${period.month}_${period.year}`;
  const out = {
    file, crsId, key, period,
    monthly: { a: {}, b: {} },
    gunny: {}, cards: {}, remit: {},
    unmapped: [], notes: [],
  };

  // ── Section A: the monthly proforma ───────────────────────────────────────
  // cols: 0 sl, 1 commodity, 2/3 open bags/kgs, 4/5 receipt, 6 transfer,
  //       7/8 total, 9/10 sales, 11 rate, 12 amount, 13/14 closing
  // Not every workbook starts this sheet in the same column — some omit the
  // leading blank, which shifts every figure one to the left and made the
  // commodity column read as the serial number ("1", "1A", "2"…). Locate the
  // COMMODITY header and offset from there rather than assuming column 1.
  const headerRow = page2.findIndex((r) => (r || []).some((c) => norm(c) === 'COMMODITY'));
  const cCol = headerRow >= 0 ? page2[headerRow].findIndex((c) => norm(c) === 'COMMODITY') : 1;
  const off = cCol - 1;
  const at = (r, i) => r[i + off];
  const firstDataRow = headerRow >= 0 ? headerRow + 2 : 5;
  if (headerRow < 0) out.notes.push('no COMMODITY header — assumed default layout');

  for (const r of page2.slice(firstDataRow)) {
    const label = norm(at(r || [], 1));
    if (!label || SECTION_A_SKIP.has(label)) continue;
    const id = SECTION_A[label];
    if (!id) {
      const figures = [3, 5, 8, 10, 14].map((i) => num(at(r, i)));
      if (TOLERATE_IF_ZERO.has(label) && figures.every((v) => v === 0)) continue;
      out.unmapped.push(`A:${label}${figures.some((v) => v !== 0) ? ' (HAS FIGURES)' : ''}`);
      continue;
    }
    const rec = {
      open: num(at(r, 3)), receipt: num(at(r, 5)), total: num(at(r, 8)),
      sales: num(at(r, 10)), close: num(at(r, 14)), amount: num(at(r, 12)),
      excess: 0, shortage: 0, transfer: num(at(r, 6)),
      g_open: num(at(r, 2)), g_receipt: num(at(r, 4)), g_total: num(at(r, 7)),
      g_sales: num(at(r, 9)), g_close: num(at(r, 13)),
    };
    if (Object.values(rec).some((v) => v !== 0)) out.monthly.a[id] = rec;
  }

  // ── Section B: police ration ──────────────────────────────────────────────
  // cols: 0 sl, 1 commodity, 2 O.B, 3 receipt, 4 total, 5 sales, 6 rate,
  //       7 amount, 8 C.B — no bag columns on this sheet.
  for (const r of rowsOf(wb, 'CRSPOLICE').slice(4)) {
    const label = norm(r?.[1]);
    if (!label || SECTION_A_SKIP.has(label)) continue;
    const id = SECTION_B[label];
    if (!id) { out.unmapped.push(`B:${label}`); continue; }
    const rec = {
      open: num(r[2]), receipt: num(r[3]), total: num(r[4]),
      sales: num(r[5]), close: num(r[8]), amount: num(r[7]),
      excess: 0, shortage: 0, transfer: 0,
      g_open: 0, g_receipt: 0, g_total: 0, g_sales: 0, g_close: 0,
    };
    if (Object.values(rec).some((v) => v !== 0)) out.monthly.b[id] = rec;
  }

  // ── Gunny stock ───────────────────────────────────────────────────────────
  // Empty-gunny figures sit in the even columns (2,4,6,8,10); the odd ones are
  // "gunny with grains", which this office leaves blank.
  for (const r of rowsOf(wb, 'GUNNY').slice(5)) {
    const id = GUNNY_ITEMS[norm(r?.[0])];
    if (!id) { if (norm(r?.[0])) out.unmapped.push(`GUNNY:${norm(r[0])}`); continue; }
    out.gunny[id] = {
      itemName: norm(r[0]), crsId: String(crsId), month: period.month, year: period.year,
      opening: num(r[2]), receipt: num(r[4]), total: num(r[6]),
      issues: num(r[8]), closing: num(r[10]),
    };
  }

  // ── Card details ──────────────────────────────────────────────────────────
  // Same column-shift problem as the proforma — CRS 9 carries a leading blank
  // column, which put the labels one across and read every count as blank.
  // Anchor on the "CARD DETAILS" header cell instead of a fixed index.
  const cardRows = rowsOf(wb, 'CARDDETAIL');
  const cHdr = cardRows.findIndex(
    (r) => (r || []).some((c) => norm(c) === 'CARD DETAILS') && (r || []).some((c) => norm(c) === 'S.NO'),
  );
  const labelCol = cHdr >= 0 ? cardRows[cHdr].findIndex((c) => norm(c) === 'CARD DETAILS') : 1;
  for (const r of cardRows.slice(cHdr >= 0 ? cHdr + 1 : 4)) {
    const id = CARD_TYPES[norm(r?.[labelCol])];
    if (!id) continue;
    out.cards[id] = { count: num(r[labelCol + 1]) };
  }

  // ── Remittance ────────────────────────────────────────────────────────────
  // Keyed by day of the SALES date, matching meRemitStore's {day: {...}} shape.
  for (const r of rowsOf(wb, 'REMITTANCE').slice(3)) {
    const d = r?.[1];
    if (!(d instanceof Date)) continue;
    const day = new Date(d.getTime() + 6 * 3600 * 1000).getUTCDate(); // sheet dates carry an IST offset
    const nonCereal = num(r[3]);
    if (!nonCereal) continue;
    out.remit[day] = { remitDate: String(r[2] ?? ''), nonCereal, cereal: 0 };
  }

  const aN = Object.keys(out.monthly.a).length, bN = Object.keys(out.monthly.b).length;
  if (!aN && !bN) out.notes.push('no commodity rows found');
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
