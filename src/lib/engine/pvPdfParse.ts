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
import { DSS_A, DSS_B } from '@/lib/engine/commodities';

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
  /**
   * The BAG counts the sheet prints beside the kgs (office, 2026-10-06): the
   * PV's bag columns are these, carried, never kgs ÷ pack. Absent where the
   * sheet gave none to read.
   */
  bags?: BagFlow;
};
/** A row's bag counts: Opening + Receipt = Total, Total − Sales = Closing. */
export type BagFlow = { open: number; receipt: number; total: number; sales: number; closing: number };
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
  /** Null when no GUNNY sheet was uploaded for the month — it is optional. */
  gunny: Record<GunnyKey, GunnyFlow> | null;
  /** Null when no CRS POLICE sheet was uploaded — optional too. */
  police: Record<string, Flow> | null;
  notes: string[];
  /** Other sheets of the workbook that were stepped over (Page 1, RBI, B6…). */
  skipped: string[];
  /**
   * Rows the reader left out and wants a person to look at — a row it does
   * not know that CARRIES FIGURES (office, 2026-10-06). The month is still
   * read; the card says "Data extraction needs review".
   */
  review: string[];
};

/**
 * A reading problem. `code` marks the two that refuse a file outright — it
 * is another shop's or another month's statement; anything else is the
 * extraction's, and the PDF is still saved (office, 2026-10-06).
 */
export class PdfReadError extends Error {
  code?: 'wrong-shop' | 'wrong-month';
  constructor(message: string, code?: 'wrong-shop' | 'wrong-month') {
    super(message);
    this.code = code;
  }
}

/**
 * Where a sheet's table ends: its foot — the summary box, the staff and
 * signature lines (our own Page 2 prints "BILL CLERK : …", or "PACKER : …"
 * for a shop with only a Packer), dates, notes, page numbers. None is a
 * commodity; reading stops there (office, 2026-10-06: CRS 19's "PACKER :
 * RAHAMATHULLAKHAN" was taken for an unknown commodity and the page refused).
 */
const FOOT = /^(BILL CLERK|PACKER|P\.?\s?K\.?\s?R\b|B\.?\s?C\b|AREA SUPERVISOR|AREA SUPERINTENDENT|SALES AMOUNT|REMITTANCE AMOUNT|NAME OF THE|CONTACT|MOBILE|PHONE|SIGNATURE|SIGN\b|DATE\b|NOTE\b|CERTIFIED|PAGE \d|TOTAL$|EXCESS$)/;

const EPS = 0.001;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const NUMBER = /^-?\d+(?:\.\d+)?$/;

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const eq = (a: number, b: number) => Math.abs(a - b) < EPS;

/** Items grouped into lines: same baseline within `tol` points, sorted top to bottom. */
/**
 * A PDF's text layer may hold two neighbouring cells as ONE piece of text —
 * CRS 11 AUG'26's PAGE2 has B.RICE's Receipt as "230 11543.42", bags and kgs
 * together (office, 2026-10-06). Read whole, it was no number at all, so the
 * Receipt came out 0 and "Opening 6400 + Receipt 0 ≠ Total 17943.42" was
 * reported. Such a run of figures is split back into one item per figure,
 * each placed where its characters sit, so each lands in its OWN column:
 * bags with bags, kgs with kgs.
 */
const RUN = /^\s*-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)+\s*$/;
export function splitRuns(items: TextItem[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of items) {
    if (!RUN.test(it.str) || !it.str.length) {
      out.push(it);
      continue;
    }
    const cw = it.w / it.str.length;
    for (const m of it.str.matchAll(/-?\d+(?:\.\d+)?/g)) {
      out.push({ str: m[0], x: it.x + (m.index ?? 0) * cw, y: it.y, w: m[0].length * cw });
    }
  }
  return out;
}

function lines(items: TextItem[], tol = 3): TextItem[][] {
  const sorted = splitRuns(items).sort((a, b) => a.y - b.y || a.x - b.x);
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
 * ("Monthly report for the month of …"), so PAGE2 is told apart by what is
 * on it: RATE / AMOUNT columns (B6 has none) and both a B.RICE and a SUGAR
 * row (Free Com has no SUGAR, Cost Com no B.RICE).
 *
 * NOT by its adjustment columns: shops' workbooks differ in whether PAGE2
 * carries EXCESS / SHORTAGE at all — CRS 1's has neither, and requiring
 * SHORTAGE stepped its PAGE2 over as "another sheet" (2026-09-22).
 */
export function pageKindOf(items: TextItem[]): PageKind | null {
  const text = norm(items.map((i) => i.str).join(' '));
  if (text.includes('GUNNY STOCK STATEMENT')) return 'gunny';
  if (text.includes('POLICE RECEIPT FOR THE MONTH')) return 'police';
  if (text.includes('MONTHLY REPORT FOR THE MONTH')) {
    const words = new Set(items.map((i) => norm(i.str)));
    if (words.has('RATE') && words.has('AMOUNT') && words.has('B.RICE') && words.has('SUGAR')) return 'page2';
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
  // CRS 29's camp stocks kerosene (commodities.ts CRS29_KERO).
  KEROSENE: 'KERO',
  'C.BOX': 'EMPTY_BOX', 'P.GUNNY': 'EMPTY_BAG',
  // Our own Page 2's spellings of the same rows (office, 2026-10-02: the
  // system's September PDF uploaded beside the office's July / August).
  'SUGAR AAY': 'AAY_SUGAR', 'ARASU SALT (CIS)': 'SALT_CIS', 'ARASU SALT (RFFS)': 'SALT_RFFS',
  // Printed, but not stock the PV counts: a subtotal, an amount-only line, a
  // non-stock product line.
  'RICE TOTAL': null, 'AAY TOTAL': null, 'RRA TOTAL': null, POLICE: null, "PALM JAGGERY'S": null, 'PALM JAGGERY': null,
  // OAP FRK is a commodity of its own on the master (CRS 20 JULY'26 holds
  // 20 kg of it); APS FRK and PHH RRA are ruled lines the forms carry for
  // lines no shop stocks, printed empty. A figure on one of those is refused
  // below, not silently dropped.
  'OAP FRK': 'OAP_FRK', 'APS FRK': null, 'PHH RRA': null,
  'PONGAL GIFT': null, 'PONGAL SUGAR': null, 'PONGAL RRA': null, 'PONGAL DHOTHI': null, 'PONGAL SAREE': null,
};
/** Rows that must be EMPTY: a figure on one is a commodity this reader cannot place. */
const PAGE2_PLACEHOLDERS = new Set(['APS FRK', 'PHH RRA', 'PONGAL GIFT', 'PONGAL SUGAR', 'PONGAL RRA', 'PONGAL DHOTHI', 'PONGAL SAREE']);
/**
 * A row label as the office's sheets spell it, matched without minding case,
 * spaces or punctuation (office, 2026-10-06: CRS 11 JULY'26 prints
 * "T.DHALL/CYL", which was left out as unknown). Accepted, in this order:
 *   1. the label as listed above;
 *   2. the same letters spelt differently — "A.A.Y" / "AAY", "SALT (CIS)" /
 *      "SALT(CIS)", "SUGAR (AAY)";
 *   3. the app's own commodity names and codes (commodities.ts: "BRA Rice",
 *      "Toor Dal", "Palm Oil", "NPHH_RRA") and the aliases below;
 *   4. "A/B" when A and B both name the SAME commodity ("T.DHALL/CYL").
 * Returns the listed label it stands for, or null when it is not a row this
 * reader knows (a line of text, or a figure to put up for review).
 */
const canon = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
function makeResolver(table: Record<string, string | null>, named: { id: string; en: string }[], extra: Record<string, string>) {
  const byCanon = new Map<string, string>();
  const keyForId = new Map<string, string>();
  for (const [k, id] of Object.entries(table)) {
    if (!byCanon.has(canon(k))) byCanon.set(canon(k), k);
    if (id && !keyForId.has(id)) keyForId.set(id, k);
  }
  const addId = (alias: string, id: string) => {
    const k = keyForId.get(id);
    if (k && !byCanon.has(canon(alias))) byCanon.set(canon(alias), k);
  };
  for (const c of named) {
    addId(c.en, c.id);
    addId(c.id, c.id);
  }
  for (const [alias, id] of Object.entries(extra)) addId(alias, id);
  const one = (label: string): string | null => (label in table ? label : byCanon.get(canon(label)) ?? null);
  return (label: string): string | null => {
    const hit = one(label);
    if (hit) return hit;
    const parts = label.split('/').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const keys = parts.map(one);
    if (keys.some((k) => !k)) return null;
    const ids = new Set(keys.map((k) => table[k!]));
    return ids.size === 1 && [...ids][0] ? keys[0] : null;
  };
}
const PAGE2_ALIASES: Record<string, string> = {
  BRA: 'BRA', 'BRA RICE': 'BRA', 'B RICE': 'BRA', AAY: 'AAY', 'AAY RICE': 'AAY', RRA: 'RRA', 'RRA RICE': 'RRA',
  'TOOR DAL': 'TOOR', 'TOOR DHALL': 'TOOR', 'TUR DAL': 'TOOR', DHALL: 'TOOR', 'PALM OIL': 'PALM',
  'AAY SUGAR': 'AAY_SUGAR', 'SUGAR AAY': 'AAY_SUGAR', 'NPHH FRK RRA RICE': 'NPHH_RRA', 'NPHH RRA': 'NPHH_RRA',
  'SALT CIS': 'SALT_CIS', 'SALT RFFS': 'SALT_RFFS', 'POLY': 'EMPTY_BAG', 'POLY GUNNY': 'EMPTY_BAG', 'CBOX': 'EMPTY_BOX',
};
const page2Label = makeResolver(PAGE2_LABELS, DSS_A, PAGE2_ALIASES);

/** Counted in pieces, printed in the BAGS columns. */
const PIECES = new Set(['EMPTY_BOX', 'EMPTY_BAG']);

/**
 * Page 2's column headings, matched with their dots taken out ("C.S" → CS).
 * C.S is a column of its own on some shops' sheets, between SALES and
 * CLOSING (office, 2026-10-07: CRS 26 JULY'26 / AUG'26, P.OIL C.S 6 bags /
 * 60 kg). Unknown, its BAGS / KGS pair was taken for CLOSING's — the nearest
 * heading — and P.OIL read as "two figures in CLOSING BAGS". The office's
 * sheets carry it into next month's Opening, so it is read as stock still
 * held (readPage2: Closing = printed CLOSING + C.S).
 */
const PAGE2_PARENTS: Record<string, keyof Flow | 'cs' | 'rate' | 'amount'> = {
  OPENING: 'open', RECEIPT: 'receipt', EXCESS: 'excess', SHORTAG: 'shortage', SHORTAGE: 'shortage',
  TRANSFER: 'transfer', TOTAL: 'total', SALES: 'sales', CS: 'cs', CLOSING: 'closing',
};
/** A heading word as PAGE2_PARENTS keys it: upper case, dots out. */
const headWord = (s: string) => norm(s).replace(/\./g, '');

type Leaf = { c: number; field: string; sub: 'BAGS' | 'KGS' | 'RATE' | 'AMOUNT' };

/** The label text of a line: everything left of the first figure column, less the SL number. */
function labelOf(l: TextItem[], firstColX: number): string {
  const text = l.filter((i) => i.x < firstColX - 4).map((i) => i.str).join(' ');
  return norm(text).replace(/^\d+[A-Z]?\s+/, '').replace(/^\d+[A-Z]?$/, '').trim();
}

export function readPage2(items: TextItem[], review: string[] = []): Record<string, Flow> {
  const ls = lines(items);
  // The sub-heading line: the one carrying the BAGS / KGS leaves.
  const leafLineIdx = ls.findIndex((l) => l.filter((i) => /^(BAGS|KGS)$/i.test(i.str.trim())).length >= 4);
  if (leafLineIdx < 0) throw new PdfReadError('CRS PAGE2: the BAGS / KGS column headings were not found.');
  const leafY = ls[leafLineIdx][0].y;
  const leaves = items
    .filter((i) => Math.abs(i.y - leafY) <= 3 && /^(BAGS|KGS|RATE|AMOUNT)$/i.test(i.str.trim()))
    .sort((a, b) => a.x - b.x);
  // The headings above the leaves. A heading printed on two lines — our own
  // Page 2 breaks SHORT / AGE and TRANS / FER — is joined when its halves
  // stand one over the other (office, 2026-10-02).
  const above = items.filter((i) => i.y < leafY - 2 && i.y > leafY - 34 && /^[A-Z]+$/.test(headWord(i.str)));
  const used = new Set<TextItem>();
  const parents: { x: number; r: number; field: keyof Flow | 'cs' }[] = [];
  for (const a of above) {
    if (used.has(a)) continue;
    let name = headWord(a.str);
    let x0 = a.x;
    let x1 = right(a);
    if (!(name in PAGE2_PARENTS)) {
      const below = above.find((b) => b !== a && !used.has(b) && b.y > a.y && b.y - a.y < 14 && Math.abs(centre(b) - centre(a)) < 12 && headWord(a.str) + headWord(b.str) in PAGE2_PARENTS);
      if (!below) continue;
      used.add(below);
      name = headWord(a.str) + headWord(below.str);
      x0 = Math.min(x0, below.x);
      x1 = Math.max(x1, right(below));
    }
    used.add(a);
    const field = PAGE2_PARENTS[name];
    if (field === 'rate' || field === 'amount') continue;
    parents.push({ x: x0, r: x1, field });
  }
  parents.sort((a, b) => a.x - b.x);

  // Each leaf belongs to the heading it stands under; a heading with no leaf
  // under it (EXCESS / SHORTAGE / TRANSFER on our own sheet) is one KGS
  // column of its own. The office's 13 known layouts and ours read alike.
  const cols: Leaf[] = [];
  // A heading's word can be narrower than the cell beneath it (OPENING over a
  // BAGS + KGS pair), so a leaf belongs to the heading whose text overlaps its
  // span, else the nearest heading — never one further than half a cell away.
  const parentOf = (x0: number, x1: number) => {
    let hit: (typeof parents)[number] | null = null;
    let best = Infinity;
    for (const p of parents) {
      const overlap = Math.min(x1, p.r) - Math.max(x0, p.x);
      const d = overlap > 0 ? 0 : Math.min(Math.abs(x0 - p.r), Math.abs(p.x - x1));
      if (d < best) { best = d; hit = p; }
    }
    return best <= 40 ? hit : null;
  };
  const taken = new Set<(typeof parents)[number]>();
  for (let i = 0; i < leaves.length; i++) {
    const sub = norm(leaves[i].str) as Leaf['sub'];
    if (sub === 'RATE' || sub === 'AMOUNT') {
      cols.push({ c: centre(leaves[i]), field: sub.toLowerCase(), sub });
      continue;
    }
    if (sub === 'BAGS') {
      const next = leaves[i + 1];
      if (!next || norm(next.str) !== 'KGS') throw new PdfReadError('CRS PAGE2: a BAGS column has no KGS beside it.');
      // A pair spans its heading: it is the heading the two together sit under.
      const parent = parentOf(leaves[i].x, right(next));
      if (!parent) throw new PdfReadError('CRS PAGE2: a BAGS / KGS pair has no heading above it.');
      taken.add(parent);
      cols.push({ c: centre(leaves[i]), field: parent.field, sub: 'BAGS' }, { c: centre(next), field: parent.field, sub: 'KGS' });
      i++;
    } else {
      const parent = parentOf(leaves[i].x, right(leaves[i]));
      if (!parent) throw new PdfReadError('CRS PAGE2: a KGS column has no heading above it.');
      taken.add(parent);
      cols.push({ c: centre(leaves[i]), field: parent.field, sub: 'KGS' });
    }
  }
  for (const p of parents) if (!taken.has(p)) cols.push({ c: (p.x + p.r) / 2, field: p.field, sub: 'KGS' });
  cols.sort((a, b) => a.c - b.c);
  for (const need of ['open', 'total', 'sales', 'closing']) {
    if (!cols.some((c) => c.field === need)) throw new PdfReadError(`CRS PAGE2: no ${need.toUpperCase()} column.`);
  }

  const firstColX = Math.min(...cols.map((c) => c.c)) - 25;
  const rows: Record<string, Flow> = {};
  // Rows read from a line with no figure on it (every cell 0 or blank).
  const blank = new Set<string>();
  for (const l of ls.slice(leafLineIdx + 1)) {
    const printedLabel = labelOf(l, firstColX);
    if (!printedLabel) continue;
    // The listed label it stands for ("T.DHALL/CYL" → "T.DHALL"), else as printed.
    const label = page2Label(printedLabel) ?? printedLabel;
    // The table ends where the sheet's foot begins — the summary box and the
    // signature line (our own Page 2 prints "BILL CLERK : …" there).
    // (FOOT: also the staff lines, e.g. "PACKER : ..." for a shop with only a Packer.)
    if (FOOT.test(label)) break;
    const hasFigure = l.some((it) => it.x >= firstColX - 4 && NUMBER.test(it.str.trim()) && Number(it.str) !== 0);
    // A line that is not a commodity is text, not data: a name, a heading,
    // a stray caption, stepped over. Only one that CARRIES FIGURES is
    // listed for review, so a real figure is never dropped without a word.
    if (!(label in PAGE2_LABELS)) {
      if (hasFigure) review.push(`CRS PAGE2: the row "${label}" has figures but is not a commodity this reader knows; left out.`);
      continue;
    }
    const id = PAGE2_LABELS[label];
    if (!id) {
      if (PAGE2_PLACEHOLDERS.has(label) && hasFigure) {
        review.push(`CRS PAGE2: the row "${label}" carries a figure, but there is no commodity to place it in; left out.`);
      }
      continue;
    }
    // Two lines for one commodity (office, 2026-10-07: CRS 29's camp sheet
    // prints T.DHALL with its Toor Dal figures AND a CYL line of 0s — both
    // Toor Dal). A line with no figure on it is a ruled line, stepped over
    // (or stepped aside for the line that has them). Two lines that BOTH
    // carry figures are still refused: nothing is dropped without a word.
    // "No figure" means no STOCK figure: CRS 29's CYL line prints its RATE
    // (30.00), which is not a quantity.
    const hasStock = l.some((it) => {
      if (it.x < firstColX - 4 || !NUMBER.test(it.str.trim()) || Number(it.str) === 0) return false;
      const col = columnOf(it, cols);
      return !!col && col.sub !== 'RATE' && col.sub !== 'AMOUNT';
    });
    if (rows[id]) {
      if (!hasStock) continue;
      if (!blank.has(id)) throw new PdfReadError(`CRS PAGE2: ${label} appears twice.`);
      delete rows[id];
      blank.delete(id);
    }

    const cell: Record<string, { BAGS?: number; KGS?: number }> = {};
    // The row's RATE and AMOUNT: not stock, only the proof of a Sales printed
    // without its decimals (checkedFlow).
    const priced: { rate?: number; amount?: number } = {};
    for (const it of l) {
      if (it.x < firstColX - 4 || !NUMBER.test(it.str.trim())) continue;
      const col = columnOf(it, cols);
      if (!col) continue;
      if (col.sub === 'RATE' || col.sub === 'AMOUNT') {
        priced[col.sub === 'RATE' ? 'rate' : 'amount'] = Number(it.str);
        continue;
      }
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
    // C.S on the office's sheet is stock STILL HELD (office, 2026-10-07): CRS
    // 26 prints P.OIL July Closing 421 beside C.S 60 and opens August at 481
    // (= 421 + 60). So it is not a sale: Issues = SALES, and the PV's Closing
    // is the printed CLOSING + C.S (= Total − Sales), which is where the next
    // month opens. (The system's own month is pvQuarter.ts's, unchanged.)
    const transferCell = qty('transfer'), total = qty('total'), sales = qty('sales'), cs = qty('cs');
    // A CLOSING cell left blank is Total − Sales, not 0: CRS 1 leaves C.BOX and
    // P.GUNNY's Closing unprinted, and its next month opens at exactly Total −
    // Sales (July C.BOX 343 + 55 = 398 → August opens 398; P.GUNNY 118 − 74 →
    // 44). A PRINTED Closing — 0 included — is still read and still checked.
    const closing = cell.closing ? r3(qty('closing') + cs) : r3(total - sales);
    const flow = checkedFlow(`CRS PAGE2 · ${label}`, { open, receipt, excess, shortage, transferCell, total, sales, closing }, priced);
    // The printed BAGS (a blank bag cell is 0; a blank Closing bag cell is
    // Total − Sales, as for the kgs). Pieces rows ARE their counts.
    if (PIECES.has(id)) {
      flow.bags = { open: flow.open, receipt: flow.receipt, total: flow.total, sales: flow.sales, closing: flow.closing };
    } else {
      const bag = (fld: string) => cell[fld]?.BAGS ?? 0;
      const bT = bag('total'), bS = bag('sales');
      flow.bags = { open: bag('open'), receipt: bag('receipt'), total: bT, sales: bS, closing: cell.closing?.BAGS !== undefined ? bag('closing') + bag('cs') : bT - bS };
    }
    rows[id] = flow;
    if (!hasStock) blank.add(id);
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
  priced: { rate?: number; amount?: number } = {},
): Flow {
  const before = f.open + f.receipt + f.excess - f.shortage;
  // A TOTAL shown without decimals (office, 2026-10-02 — CRS 20 JULY'26 PHH
  // FRK: 4411.48 + 0 printed as 4411; AUG'26: 1.538 + 2500 printed as 2502).
  // The workbook cell holds the exact sum and only DISPLAYS it rounded to
  // the kilo. Taken as the exact sum only when the row proves it: the
  // printed Total is a whole number within half a kilo of the sum (with the
  // transfer, in or out, where one is printed — JULY'26 NPHH FRK 4580.046 +
  // 20 printed as 4600), and the exact sum − Sales is the printed Closing to
  // the gram. Anything else is still refused.
  if (Number.isInteger(f.total)) {
    const sums = f.transferCell ? [before + f.transferCell, before - f.transferCell] : [before];
    const exact = sums.find((s) => !eq(f.total, s) && Math.abs(f.total - s) < 0.5 && eq(s - f.sales, f.closing));
    if (exact !== undefined) f = { ...f, total: r3(exact) };
  }
  const delta = r3(f.total - before);
  let transfer = 0;
  if (f.transferCell) {
    if (eq(delta, f.transferCell)) transfer = f.transferCell;
    else if (eq(delta, -f.transferCell)) transfer = -f.transferCell;
    else throw new PdfReadError(`${where}: does not add up — Opening ${f.open} + Receipt ${f.receipt} + Excess ${f.excess} − Shortage ${f.shortage} with Transfer ${f.transferCell} is not the Total ${f.total}.`);
  } else if (!eq(delta, 0)) {
    throw new PdfReadError(`${where}: does not add up — Opening ${f.open} + Receipt ${f.receipt} + Excess ${f.excess} − Shortage ${f.shortage} = ${r3(before)}, but the Total says ${f.total}.`);
  }
  // A SALES shown without decimals, as a TOTAL can be (office, 2026-10-07 —
  // CRS 27 JULY'26 T.DHALL: Sales printed 1014, Amount 30419.40 at 30.00 =
  // 1013.98 kg, and 1687 − 1013.98 = the printed Closing 673.02). Taken as
  // Total − Closing ONLY when the row proves it: the printed Sales is a whole
  // number within half a kilo of it, and — where the row prints a rate and an
  // amount — rate × that figure is the printed Amount to the paisa. A row
  // with a rate but no amount, or an amount that does not agree, is refused.
  if (!eq(f.total - f.sales, f.closing) && Number.isInteger(f.sales)) {
    const exact = r3(f.total - f.closing);
    const near = Math.abs(exact - f.sales) < 0.5;
    const proved = priced.rate ? priced.amount !== undefined && Math.abs(exact * priced.rate - priced.amount) < 0.005 : !priced.amount;
    if (near && proved) f = { ...f, sales: exact };
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
const policeLabel = makeResolver(POLICE_LABELS, DSS_B.map((c) => ({ id: c.id, en: c.en.replace(/\s*\(Police\)$/i, '') })), {
  'BRA RICE': 'PB_BRA', 'B.RICE': 'PB_BRA', CYL: 'PB_TOOR', 'TOOR DAL': 'PB_TOOR', 'PALM OIL': 'PB_PALM',
});
const POLICE_COLS: Record<string, string> = { 'O.B': 'open', RECEIPT: 'receipt', TOTAL: 'total', SALES: 'sales', RATE: 'rate', AMOUNT: 'amount', 'C.B': 'closing' };

export function readPolice(items: TextItem[], review: string[] = []): Record<string, Flow> {
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
    if (FOOT.test(label)) break;
    const known = policeLabel(label);
    const id = known ? POLICE_LABELS[known] : undefined;
    if (!id) {
      // Text, not data — unless it carries figures, which a person should see.
      if (l.some((it) => it.x >= firstColX - 4 && NUMBER.test(it.str.trim()) && Number(it.str) !== 0)) {
        review.push(`CRS POLICE: the row "${label}" has figures but is not a police commodity this reader knows — left out.`);
      }
      continue;
    }
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
export function readPage(items: TextItem[], review: string[] = []): PageRead {
  const kind = pageKindOf(items);
  if (!kind) throw new PdfReadError('This page is not a CRS PAGE2, GUNNY STOCK or CRS POLICE sheet.');
  const titleText = lines(items).slice(0, 8).map(lineText).join(' ');
  const my = monthYearOf(titleText);
  const crsId = crsOf(titleText);
  const name = kind === 'page2' ? 'CRS PAGE2' : kind === 'gunny' ? 'GUNNY' : 'CRS POLICE';
  if (!my) throw new PdfReadError(`${name}: the month was not found in its title.`);
  if (!crsId) throw new PdfReadError(`${name}: the CRS number was not found in its title.`);
  if (kind === 'page2') return { kind, crsId, ...my, rows: readPage2(items, review) };
  if (kind === 'police') return { kind, crsId, ...my, rows: readPolice(items, review) };
  const g = readGunny(items);
  return { kind, crsId, ...my, gunny: g.gunny, notes: g.notes };
}

/**
 * A month from its pages — any number of PDFs, any number of pages, in any
 * order. **CRS PAGE2 is the one sheet a month needs**; GUNNY and CRS POLICE are
 * read when they are there (office, 2026-09-22). Every page read must be this
 * shop and this month. Other sheets (Page 1, RBI, B6…) are stepped over and
 * named in `skipped`, so the whole workbook saved as one PDF can be uploaded.
 *
 * The same sheet twice with the same figures (a file picked again) counts
 * once; twice with DIFFERENT figures is refused — which one is right is not
 * this reader's to guess.
 */
export function readMonthPages(
  pages: { file: string; items: TextItem[] }[],
  want: { crsId: number; month: number; year: number },
): PdfMonth {
  const MN = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const mon = `${MN[want.month]} ${want.year}`;
  let page2: Record<string, Flow> | null = null;
  let gunny: Record<GunnyKey, GunnyFlow> | null = null;
  let police: Record<string, Flow> | null = null;
  let notes: string[] = [];
  const skipped: string[] = [];
  const review: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const p of pages) {
    if (!p.items.some((i) => i.str.trim())) continue; // a blank page
    if (!pageKindOf(p.items)) {
      if (!skipped.includes(p.file)) skipped.push(p.file);
      continue;
    }
    let r: PageRead;
    const pageReview: string[] = [];
    try {
      r = readPage(p.items, pageReview);
    } catch (e) {
      // One file's unreadable sheet never stops the month (office, 2026-10-06:
      // "If PDF 2 fails extraction, PDF 1 must still remain"): it is left out
      // and named for review, and the other files are read as ever.
      const why = `${p.file} could not be read — ${e instanceof Error ? e.message : String(e)} Left out.`;
      if (!review.includes(why)) review.push(why);
      continue;
    }
    for (const w of pageReview) if (!review.includes(`${p.file}: ${w}`)) review.push(`${p.file}: ${w}`);
    if (r.crsId !== want.crsId) throw new PdfReadError(`${p.file}: this is CRS ${r.crsId}'s statement, not CRS ${want.crsId}'s.`, 'wrong-shop');
    if (r.month !== want.month || r.year !== want.year) throw new PdfReadError(`${p.file}: this is ${MN[r.month]} ${r.year}, not ${mon}.`, 'wrong-month');
    if (r.kind === 'page2') {
      if (page2 && !same(page2, r.rows)) review.push(`${p.file}: its CRS PAGE2 differs from an earlier PDF's; the latest upload is used.`);
      page2 = r.rows;
    } else if (r.kind === 'gunny') {
      if (gunny && !same(gunny, r.gunny)) review.push(`${p.file}: its GUNNY sheet differs from an earlier PDF's; the latest upload is used.`);
      gunny = r.gunny;
      notes = r.notes;
    } else {
      if (police && !same(police, r.rows)) review.push(`${p.file}: its CRS POLICE differs from an earlier PDF's; the latest upload is used.`);
      police = r.rows;
    }
  }
  if (!page2) {
    // A file was given but is not a PAGE2 this reader recognises: say so
    // plainly rather than leave the month waiting.
    const likely = skipped.filter((f) => /PAGE\s*-?\s*2/i.test(f));
    if (likely.length) throw new PdfReadError(`${mon} CRS PAGE2 could not be read — ${likely.join(', ')} is not laid out as a CRS PAGE2. Please upload the correct PDF.`);
    const unread = review.filter((r) => / could not be read — /.test(r));
    if (unread.length) throw new PdfReadError(`${mon}: no CRS PAGE2 could be read. ${unread.join(' ')}`);
    throw new PdfReadError(`${mon}: still needs CRS PAGE2.`);
  }
  return { crsId: want.crsId, month: want.month, year: want.year, rows: page2, gunny, police, notes, skipped, review };
}

/** What ONE saved file holds, for its own line on the card (office, 2026-10-06). */
export type FileSummary = {
  /** Pages in the file. */
  pages: number;
  /** The sheets read from it, in page order, once each: 'CRS PAGE2', 'GUNNY', 'CRS POLICE'. */
  sheets: string[];
  /** Pages of other sheets (Page 1, RBI, B6…), stepped over. */
  skipped: number;
  /** What could not be read, or was left out — the file is still saved. */
  problems: string[];
};

/**
 * One file read on its own, for its status line — never decides the month
 * (readMonthPages does that over all the month's files together).
 */
export function readFileSummary(items: TextItem[][], want: { crsId: number; month: number; year: number }): FileSummary {
  const out: FileSummary = { pages: items.length, sheets: [], skipped: 0, problems: [] };
  for (const page of items) {
    if (!page.some((i) => i.str.trim())) continue;
    if (!pageKindOf(page)) {
      out.skipped++;
      continue;
    }
    const rev: string[] = [];
    try {
      const r = readPage(page, rev);
      const name = r.kind === 'page2' ? 'CRS PAGE2' : r.kind === 'gunny' ? 'GUNNY' : 'CRS POLICE';
      if (r.crsId !== want.crsId) out.problems.push(`${name} is CRS ${r.crsId}'s, not CRS ${want.crsId}'s.`);
      else if (r.month !== want.month || r.year !== want.year) out.problems.push(`${name} is for another month.`);
      else if (!out.sheets.includes(name)) out.sheets.push(name);
    } catch (e) {
      out.problems.push(e instanceof Error ? e.message : String(e));
    }
    for (const w of rev) if (!out.problems.includes(w)) out.problems.push(w);
  }
  return out;
}
