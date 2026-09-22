/**
 * Reading a month's figures out of the office's own statement PDFs — the
 * CRS PAGE2, GUNNY and CRS POLICE sheets of the monthly workbook, each saved
 * as its own PDF — for the 3-month PV (office, 2026-09-22).
 *
 * WHY THIS IS CAREFUL. These figures go onto a statutory PV. A PDF has no
 * cells, only text drawn at positions, and a text dump of these sheets is
 * already wrong: an empty cell simply vanishes, so every figure after it slides
 * a column left (SUGAR(AAY) has no opening bags), and the Police sheet's
 * closing balances come out a line above their rows. So nothing here reads
 * text in order. Every figure is placed by WHERE it is drawn:
 *
 *   - the row is the commodity label on the same line;
 *   - the column is the rightmost column heading whose centre lies left of
 *     the figure's right edge — figures are right-aligned in their cells, and
 *     every cell's right edge falls short of the next heading's centre, so
 *     this separates even the close calls (a 0 in AMOUNT sits 18px from
 *     CLOSING's bags);
 *   - Page 2's two-level headings (OPENING → BAGS / KGS) are resolved by
 *     walking the sub-headings left to right, so the 13 different column
 *     layouts the office's workbooks are known to have all read the same way.
 *
 * AND EVERY ROW IS CHECKED BY ITS OWN ARITHMETIC before it is believed:
 * Opening + Receipt + Excess − Shortage ± Transfer = Total, Total − Sales =
 * Closing (Gunny and Police the same without the adjustments). A row that does
 * not add up is refused with its figures, never guessed.
 *
 * Pure: it takes positioned text items and knows nothing of pdf.js, so the
 * same code runs in the browser and in tools/verify-pv-quarter.mjs.
 */

/** One piece of text as drawn: x from the left, y from the TOP, in points. */
export type TextItem = { str: string; x: number; y: number; w: number };

export type Flow = {
  open: number;
  receipt: number;
  excess: number;
  shortage: number;
  /** Net: positive = transferred IN, negative = transferred OUT. */
  transfer: number;
  total: number;
  sales: number;
  closing: number;
};
export type GunnyFlow = { opening: number; receipt: number; total: number; issues: number; closing: number };
export type GunnyKey = 'ss50' | 'poly' | 'cbox';

export type PageKind = 'page2' | 'gunny' | 'police';
export type PageRead =
  | { kind: 'page2'; crsId: number; month: number; year: number; rows: Record<string, Flow> }
  | { kind: 'gunny'; crsId: number; month: number; year: number; gunny: Record<GunnyKey, GunnyFlow>; notes: string[] }
  | { kind: 'police'; crsId: number; month: number; year: number; rows: Record<string, Flow> };

/** Everything one month's uploaded PDFs say. */
export type PdfMonth = {
  crsId: number;
  month: number;
  year: number;
  rows: Record<string, Flow>;
  gunny: Record<GunnyKey, GunnyFlow>;
  police: Record<string, Flow> | null;
  notes: string[];
};

export class PdfReadError extends Error {}

const EPS = 0.001;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const NUMBER = /^-?\d+(?:\.\d+)?$/;

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const eq = (a: number, b: number) => Math.abs(a - b) < EPS;

/** Items grouped into lines: same baseline within `tol` points, sorted top to bottom. */
function lines(items: TextItem[], tol = 3): TextItem[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: TextItem[][] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= tol) last.push(it);
    else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

const lineText = (l: TextItem[]) => l.map((i) => i.str).join(' ');
const centre = (i: TextItem) => i.x + i.w / 2;
const right = (i: TextItem) => i.x + i.w;

/** "JUNE'2026", "AUG'26", "SEPTEMBER 2026" → { month, year }. */
export function monthYearOf(text: string): { month: number; year: number } | null {
  const m = norm(text).match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*['’`"]?\s*(\d{4}|\d{2})\b/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]) + 1;
  const y = Number(m[2]);
  return { month, year: y < 100 ? 2000 + y : y };
}

/** "CRS NO: 9", "CRS 9", "CRS.9" → 9. */
export function crsOf(text: string): number | null {
  const m = norm(text).match(/\bCRS\s*(?:NO)?\s*[:.\-]?\s*(\d{1,2})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Which sheet this page is. B6, Free Com and Cost Com share CRS PAGE2's title
 * ("Monthly report for the month of …"), so PAGE2 is told apart by its
 * columns: it is the one sheet with both a SHORTAGE column and RATE / AMOUNT
 * (B6 has no money columns; Free and Cost Com no adjustments).
 */
export function pageKindOf(items: TextItem[]): PageKind | null {
  const text = norm(items.map((i) => i.str).join(' '));
  if (text.includes('GUNNY STOCK STATEMENT')) return 'gunny';
  if (text.includes('POLICE RECEIPT FOR THE MONTH')) return 'police';
  if (text.includes('MONTHLY REPORT FOR THE MONTH')) {
    const words = new Set(items.map((i) => norm(i.str)));
    const shortage = [...words].some((w) => w.startsWith('SHORTAG'));
    if (shortage && words.has('RATE') && words.has('AMOUNT')) return 'page2';
  }
  return null;
}

/**
 * The column a right-aligned figure belongs to: the rightmost heading whose
 * centre lies left of the figure's right edge. Null if it lies left of all.
 */
function columnOf<T extends { c: number }>(item: TextItem, cols: T[]): T | null {
  const edge = right(item) - 1;
  let hit: T | null = null;
  for (const c of cols) if (c.c < edge) hit = c;
  return hit;
}

// ── CRS PAGE2 ─────────────────────────────────────────────────────────────

/** Page 2 row labels → commodity ids. Labels not listed stop the read. */
const PAGE2_LABELS: Record<string, string | null> = {
  'B.RICE': 'BRA', 'A.A.Y': 'AAY', 'R.R.A': 'RRA', SUGAR: 'SUGAR', 'SUGAR(AAY)': 'AAY_SUGAR',
  WHEAT: 'WHEAT', CYL: 'TOOR', 'T.DHALL': 'TOOR', 'T.DAL': 'TOOR', 'P.OIL': 'PALM', OOTY: 'OOTY', TAN: 'TAN',
  'SALT(CIS)': 'SALT_CIS', 'SALT(RFFS)': 'SALT_RFFS', OAP: 'OAP', APS: 'APS', 'PHH BRA': 'PHH_BRA',
  'PHH FRK': 'PHH_FRK', 'AAY FRK': 'AAY_FRK', 'NPHH FRK': 'NPHH_FRK', 'NPHH FRK RRA': 'NPHH_RRA',
  'C.BOX': 'EMPTY_BOX', 'P.GUNNY': 'EMPTY_BAG',
  // Printed, but not stock the PV counts: a subtotal, an amount-only line, a
  // non-stock product line.
  'RICE TOTAL': null, POLICE: null, "PALM JAGGERY'S": null, 'PALM JAGGERY': null,
};
/** Counted in pieces, printed in the BAGS columns. */
const PIECES = new Set(['EMPTY_BOX', 'EMPTY_BAG']);

const PAGE2_PARENTS: Record<string, keyof Flow | 'rate' | 'amount'> = {
  OPENING: 'open', RECEIPT: 'receipt', EXCESS: 'excess', SHORTAG: 'shortage', SHORTAGE: 'shortage',
  TRANSFER: 'transfer', TOTAL: 'total', SALES: 'sales', CLOSING: 'closing',
};

type Leaf = { c: number; field: string; sub: 'BAGS' | 'KGS' | 'RATE' | 'AMOUNT' };

/** The label text of a line: everything left of the first figure column, less the SL number. */
function labelOf(l: TextItem[], firstColX: number): string {
  const text = l.filter((i) => i.x < firstColX - 4).map((i) => i.str).join(' ');
  return norm(text).replace(/^\d+[A-Z]?\s+/, '').replace(/^\d+[A-Z]?$/, '').trim();
}

export function readPage2(items: TextItem[]): Record<string, Flow> {
  const ls = lines(items);
  // The sub-heading line: the one carrying the BAGS / KGS leaves.
  const leafLineIdx = ls.findIndex((l) => l.filter((i) => /^(BAGS|KGS)$/i.test(i.str.trim())).length >= 4);
  if (leafLineIdx < 0) throw new PdfReadError('CRS PAGE2: the BAGS / KGS column headings were not found.');
  const leafY = ls[leafLineIdx][0].y;
  const leaves = items
    .filter((i) => Math.abs(i.y - leafY) <= 3 && /^(BAGS|KGS|RATE|AMOUNT)$/i.test(i.str.trim()))
    .sort((a, b) => a.x - b.x);
  const parents = items
    .filter((i) => i.y < leafY && i.y > leafY - 30 && norm(i.str) in PAGE2_PARENTS)
    .sort((a, b) => a.x - b.x);

  // Walk: each parent takes BAGS+KGS, or a single KGS; RATE and AMOUNT stand alone.
  const cols: Leaf[] = [];
  let p = 0;
  for (let i = 0; i < leaves.length; i++) {
    const sub = norm(leaves[i].str) as Leaf['sub'];
    if (sub === 'RATE' || sub === 'AMOUNT') {
      cols.push({ c: centre(leaves[i]), field: sub.toLowerCase(), sub });
      continue;
    }
    const parent = parents[p];
    if (!parent) throw new PdfReadError(`CRS PAGE2: a ${sub} column has no heading above it.`);
    const field = PAGE2_PARENTS[norm(parent.str)];
    if (sub === 'BAGS') {
      const next = leaves[i + 1];
      if (!next || norm(next.str) !== 'KGS') throw new PdfReadError(`CRS PAGE2: ${norm(parent.str)} has BAGS without KGS.`);
      cols.push({ c: centre(leaves[i]), field, sub: 'BAGS' }, { c: centre(next), field, sub: 'KGS' });
      i++;
    } else {
      cols.push({ c: centre(leaves[i]), field, sub: 'KGS' });
    }
    p++;
  }
  if (p !== parents.length) throw new PdfReadError(`CRS PAGE2: ${parents.length} column headings but ${p} sets of BAGS / KGS under them — the layout is not one this reader knows.`);
  for (const need of ['open', 'total', 'sales', 'closing']) {
    if (!cols.some((c) => c.field === need)) throw new PdfReadError(`CRS PAGE2: no ${need.toUpperCase()} column.`);
  }

  const firstColX = Math.min(...cols.map((c) => c.c)) - 25;
  const rows: Record<string, Flow> = {};
  for (const l of ls.slice(leafLineIdx + 1)) {
    const label = labelOf(l, firstColX);
    if (!label) continue;
    if (!(label in PAGE2_LABELS)) throw new PdfReadError(`CRS PAGE2: the row "${label}" is not a commodity this reader knows — nothing was read.`);
    const id = PAGE2_LABELS[label];
    if (!id) continue;
    if (rows[id]) throw new PdfReadError(`CRS PAGE2: ${label} appears twice.`);

    const cell: Record<string, { BAGS?: number; KGS?: number }> = {};
    for (const it of l) {
      if (it.x < firstColX - 4 || !NUMBER.test(it.str.trim())) continue;
      const col = columnOf(it, cols);
      if (!col) continue;
      if (col.sub === 'RATE' || col.sub === 'AMOUNT') continue;
      const slot = (cell[col.field] ??= {});
      if (slot[col.sub] !== undefined) throw new PdfReadError(`CRS PAGE2: ${label} has two figures in ${col.field.toUpperCase()} ${col.sub}.`);
      slot[col.sub] = Number(it.str);
    }
    const qty = (f: string) => {
      const s = cell[f];
      if (!s) return 0;
      return PIECES.has(id) ? (s.BAGS ?? s.KGS ?? 0) : (s.KGS ?? 0);
    };
    const open = qty('open'), receipt = qty('receipt'), excess = qty('excess'), shortage = qty('shortage');
    const transferCell = qty('transfer'), total = qty('total'), sales = qty('sales'), closing = qty('closing');
    rows[id] = checkedFlow(`CRS PAGE2 · ${label}`, { open, receipt, excess, shortage, transferCell, total, sales, closing });
  }
  if (!Object.keys(rows).length) throw new PdfReadError('CRS PAGE2: no commodity rows were read.');
  return rows;
}

/**
 * A row believed only if it adds up. Transfer's direction is not printed, so
 * it is whichever sign makes the row's own TOTAL come out: in if it adds,
 * out if it subtracts.
 */
function checkedFlow(
  where: string,
  f: { open: number; receipt: number; excess: number; shortage: number; transferCell: number; total: number; sales: number; closing: number },
): Flow {
  const before = f.open + f.receipt + f.excess - f.shortage;
  const delta = r3(f.total - before);
  let transfer = 0;
  if (f.transferCell) {
    if (eq(delta, f.transferCell)) transfer = f.transferCell;
    else if (eq(delta, -f.transferCell)) transfer = -f.transferCell;
    else throw new PdfReadError(`${where}: does not add up — Opening ${f.open} + Receipt ${f.receipt} + Excess ${f.excess} − Shortage ${f.shortage} with Transfer ${f.transferCell} is not the Total ${f.total}.`);
  } else if (!eq(delta, 0)) {
    throw new PdfReadError(`${where}: does not add up — Opening ${f.open} + Receipt ${f.receipt} + Excess ${f.excess} − Shortage ${f.shortage} = ${r3(before)}, but the Total says ${f.total}.`);
  }
  if (!eq(f.total - f.sales, f.closing)) {
    throw new PdfReadError(`${where}: does not add up — Total ${f.total} − Sales ${f.sales} = ${r3(f.total - f.sales)}, but the Closing says ${f.closing}.`);
  }
  return { open: f.open, receipt: f.receipt, excess: f.excess, shortage: f.shortage, transfer, total: f.total, sales: f.sales, closing: f.closing };
}

// ── GUNNY ─────────────────────────────────────────────────────────────────

const GUNNY_LABELS: Record<string, GunnyKey> = { '50KG SS': 'ss50', '50 KG SS': 'ss50', POLY: 'poly', 'C. BOX': 'cbox', 'C.BOX': 'cbox', 'C BOX': 'cbox' };
const GUNNY_STAGES: Record<string, keyof GunnyFlow> = { OPENING: 'opening', RECEIPT: 'receipt', TOTAL: 'total', ISSUES: 'issues', CLOSING: 'closing', 'CLOSING BALANCE': 'closing' };

export function readGunny(items: TextItem[]): { gunny: Record<GunnyKey, GunnyFlow>; notes: string[] } {
  const ls = lines(items);
  // Sub-headings: GUNNY (with grains) and EMPTY, in pairs, one pair per stage.
  const leafIdx = ls.findIndex((l) => l.filter((i) => /^(GUNNY|EMPTY)$/i.test(i.str.trim())).length >= 6);
  if (leafIdx < 0) throw new PdfReadError('GUNNY: the GUNNY / EMPTY column headings were not found.');
  const leafY = ls[leafIdx][0].y;
  const leaves = ls[leafIdx].filter((i) => /^(GUNNY|EMPTY)$/i.test(i.str.trim()));
  const stages = items
    .filter((i) => i.y < leafY && i.y > leafY - 40 && norm(i.str) in GUNNY_STAGES)
    .sort((a, b) => a.x - b.x);
  if (leaves.length !== stages.length * 2) throw new PdfReadError(`GUNNY: ${stages.length} stages but ${leaves.length} sub-columns — the layout is not one this reader knows.`);
  const cols = leaves.map((l, i) => ({ c: centre(l), stage: GUNNY_STAGES[norm(stages[Math.floor(i / 2)].str)] }));
  const firstColX = cols[0].c - 25;

  const gunny = {} as Record<GunnyKey, GunnyFlow>;
  let lastRowY = leafY;
  const dataLines = ls.slice(leafIdx + 1).filter((l) => !/^(WITH GRAINS|GUNNY|EMPTY|BALANCE)(\s|$)/i.test(norm(lineText(l))));
  for (const l of dataLines) {
    const label = norm(l.filter((i) => i.x < firstColX - 4).map((i) => i.str).join(' '));
    const key = GUNNY_LABELS[label];
    if (!key) continue;
    const sums: Record<string, number> = {};
    for (const it of l) {
      if (it.x < firstColX - 4 || !NUMBER.test(it.str.trim())) continue;
      const col = columnOf(it, cols);
      if (!col) continue;
      // A variety's figure sits in one of its stage's two sub-columns (the
      // office moved them all to EMPTY GUNNY); the stage is what counts.
      sums[col.stage] = (sums[col.stage] ?? 0) + Number(it.str);
    }
    const g: GunnyFlow = { opening: sums.opening ?? 0, receipt: sums.receipt ?? 0, total: sums.total ?? 0, issues: sums.issues ?? 0, closing: sums.closing ?? 0 };
    if (!eq(g.opening + g.receipt, g.total)) throw new PdfReadError(`GUNNY · ${label}: does not add up — Opening ${g.opening} + Receipt ${g.receipt} is not the Total ${g.total}.`);
    if (!eq(g.total - g.issues, g.closing)) throw new PdfReadError(`GUNNY · ${label}: does not add up — Total ${g.total} − Issues ${g.issues} is not the Closing ${g.closing}.`);
    gunny[key] = g;
    lastRowY = Math.max(lastRowY, l[0].y);
  }
  for (const k of ['ss50', 'poly', 'cbox'] as const) {
    if (!gunny[k]) gunny[k] = { opening: 0, receipt: 0, total: 0, issues: 0, closing: 0 };
  }
  if (!dataLines.some((l) => GUNNY_LABELS[norm(l.filter((i) => i.x < firstColX - 4).map((i) => i.str).join(' '))])) {
    throw new PdfReadError('GUNNY: no 50KG SS / POLY / C. BOX rows were read.');
  }

  // Classification notes typed below the table, exactly as written.
  const notes = ls
    .filter((l) => l[0].y > lastRowY)
    .map((l) => lineText(l).replace(/\s+/g, ' ').trim())
    .filter((t) => /\bCONSIDER(ED)?\b/i.test(t));
  return { gunny, notes };
}

// ── CRS POLICE ────────────────────────────────────────────────────────────

const POLICE_LABELS: Record<string, string> = { 'B.R.A': 'PB_BRA', BRA: 'PB_BRA', SUGAR: 'PB_SUGAR', WHEAT: 'PB_WHEAT', 'T.DHALL': 'PB_TOOR', 'T.DAL': 'PB_TOOR', 'P.OIL': 'PB_PALM' };
const POLICE_COLS: Record<string, string> = { 'O.B': 'open', RECEIPT: 'receipt', TOTAL: 'total', SALES: 'sales', RATE: 'rate', AMOUNT: 'amount', 'C.B': 'closing' };

export function readPolice(items: TextItem[]): Record<string, Flow> {
  const ls = lines(items);
  const hdrIdx = ls.findIndex((l) => l.filter((i) => norm(i.str) in POLICE_COLS).length >= 5);
  if (hdrIdx < 0) throw new PdfReadError('CRS POLICE: the O.B / RECEIPT / TOTAL / SALES / C.B headings were not found.');
  const cols = ls[hdrIdx].filter((i) => norm(i.str) in POLICE_COLS).map((i) => ({ c: centre(i), field: POLICE_COLS[norm(i.str)] }));
  for (const need of ['open', 'total', 'closing']) if (!cols.some((c) => c.field === need)) throw new PdfReadError(`CRS POLICE: no ${need.toUpperCase()} column.`);
  const firstColX = Math.min(...cols.map((c) => c.c)) - 20;

  const rows: Record<string, Flow> = {};
  for (const l of ls.slice(hdrIdx + 1)) {
    const label = norm(l.filter((i) => i.x < firstColX - 4).map((i) => i.str).join(' ')).replace(/^\d+\s+/, '');
    if (!label || /TOTAL/.test(label)) continue;
    const id = POLICE_LABELS[label];
    if (!id) throw new PdfReadError(`CRS POLICE: the row "${label}" is not a police commodity this reader knows — nothing was read.`);
    const v: Record<string, number> = {};
    for (const it of l) {
      if (it.x < firstColX - 4 || !NUMBER.test(it.str.trim())) continue;
      const col = columnOf(it, cols);
      if (!col || col.field === 'rate' || col.field === 'amount') continue;
      if (v[col.field] !== undefined) throw new PdfReadError(`CRS POLICE · ${label}: two figures in ${col.field.toUpperCase()}.`);
      v[col.field] = Number(it.str);
    }
    rows[id] = checkedFlow(`CRS POLICE · ${label}`, {
      open: v.open ?? 0, receipt: v.receipt ?? 0, excess: 0, shortage: 0, transferCell: 0,
      total: v.total ?? 0, sales: v.sales ?? 0, closing: v.closing ?? 0,
    });
  }
  if (!Object.keys(rows).length) throw new PdfReadError('CRS POLICE: no police rows were read.');
  return rows;
}

// ── A page, and a month ───────────────────────────────────────────────────

/** One page: which sheet, whose, which month — then its table. */
export function readPage(items: TextItem[]): PageRead {
  const kind = pageKindOf(items);
  if (!kind) throw new PdfReadError('This page is not a CRS PAGE2, GUNNY STOCK or CRS POLICE sheet.');
  const titleText = lines(items).slice(0, 8).map(lineText).join(' ');
  const my = monthYearOf(titleText);
  const crsId = crsOf(titleText);
  const name = kind === 'page2' ? 'CRS PAGE2' : kind === 'gunny' ? 'GUNNY' : 'CRS POLICE';
  if (!my) throw new PdfReadError(`${name}: the month was not found in its title.`);
  if (!crsId) throw new PdfReadError(`${name}: the CRS number was not found in its title.`);
  if (kind === 'page2') return { kind, crsId, ...my, rows: readPage2(items) };
  if (kind === 'police') return { kind, crsId, ...my, rows: readPolice(items) };
  const g = readGunny(items);
  return { kind, crsId, ...my, gunny: g.gunny, notes: g.notes };
}

/**
 * A month from its pages — any number of PDFs, any number of pages. Needs one
 * CRS PAGE2 and one GUNNY, and a CRS POLICE when `needsPolice`; every page
 * read must be this shop and this month. Other sheets (Page 1, RBI, Receipt…)
 * are stepped over, so the whole workbook saved as one PDF can be uploaded.
 */
export function readMonthPages(
  pages: { file: string; items: TextItem[] }[],
  want: { crsId: number; month: number; year: number; needsPolice: boolean },
): PdfMonth {
  const MN = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let page2: Record<string, Flow> | null = null;
  let gunny: Record<GunnyKey, GunnyFlow> | null = null;
  let police: Record<string, Flow> | null = null;
  let notes: string[] = [];
  for (const p of pages) {
    if (!p.items.some((i) => i.str.trim())) continue; // a blank page
    if (!pageKindOf(p.items)) continue; // a sheet the PV does not use
    let r: PageRead;
    try {
      r = readPage(p.items);
    } catch (e) {
      throw new PdfReadError(`${p.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.crsId !== want.crsId) throw new PdfReadError(`${p.file}: this is CRS ${r.crsId}'s statement, not CRS ${want.crsId}'s.`);
    if (r.month !== want.month || r.year !== want.year) throw new PdfReadError(`${p.file}: this is ${MN[r.month]} ${r.year}, not ${MN[want.month]} ${want.year}.`);
    if (r.kind === 'page2') {
      if (page2) throw new PdfReadError(`${p.file}: a second CRS PAGE2 for ${MN[want.month]} — upload it once.`);
      page2 = r.rows;
    } else if (r.kind === 'gunny') {
      if (gunny) throw new PdfReadError(`${p.file}: a second GUNNY sheet for ${MN[want.month]} — upload it once.`);
      gunny = r.gunny;
      notes = r.notes;
    } else {
      if (police) throw new PdfReadError(`${p.file}: a second CRS POLICE for ${MN[want.month]} — upload it once.`);
      police = r.rows;
    }
  }
  const missing = [!page2 && 'CRS PAGE2', !gunny && 'GUNNY', want.needsPolice && !police && 'CRS POLICE'].filter(Boolean);
  if (missing.length) throw new PdfReadError(`${MN[want.month]} ${want.year}: still needs ${missing.join(' and ')}.`);
  return { crsId: want.crsId, month: want.month, year: want.year, rows: page2!, gunny: gunny!, police, notes };
}
