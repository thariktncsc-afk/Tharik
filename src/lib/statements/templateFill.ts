/**
 * Putting a statement's figures into the office's own sheet.
 *
 * The workbook is the form; the statement engine has the figures. This joins
 * them BY CAPTION: a template cell that reads "RICE CARD        : " takes the
 * statement's RICE CARD figure, and nothing else. Matching on what the office
 * wrote — rather than on position — means a cell can only ever receive the
 * figure it asks for, and anything that does not match is REPORTED instead of
 * guessed at.
 *
 * That reporting matters. The office's own CRS PAGE 1 lists its card rows in a
 * different order from ours (RICE, SUGAR, AAY, LOF RICE, POLICE, N', LOF
 * SUGAR, OAP) and its allotment lines differ too — its first line is
 * "1.RICE&AAY" where ours says "1.NPHH&AAY FRK", and ours carries a sixth line
 * the office's sheet has no room for. Filling by caption puts every figure
 * where the office expects it and leaves the genuine disagreements visible.
 */
import { parseStatement } from '@/lib/statements/sheetModel';
import type { TemplateSheet, Values } from '@/lib/statements/templateRender';

/** A caption and what the statement has to say after it. */
export type Line = { label: string; value: string };

/** Comparable form of a caption: letters and digits, nothing else. */
export const captionKey = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * The statement's own "caption : value" lines, in the order it prints them.
 *
 * Read from the rendered statement, so it is the figures a shop would be
 * handed — not a second calculation of them.
 */
export function linesOf(html: string): Line[] {
  const out: Line[] = [];
  for (const row of parseStatement(html).rows) {
    for (const cell of row) {
      for (const piece of cell.text.split('\n')) {
        const m = piece.match(/^([^:]+?)\s*:\s*(.*)$/);
        if (m && m[1].trim()) out.push({ label: m[1].trim(), value: m[2].trim() });
      }
    }
  }
  return out;
}

/**
 * Captions that name the same slot in different words. Deliberately short:
 * every entry here is a judgement that two wordings mean one thing, and a
 * wrong one puts a figure on a statutory form under the wrong heading.
 */
const SAME_SLOT: RegExp[] = [/^NAME OF THE\b/i];

export type Filled = {
  values: Values;
  /** Template cells that asked for a figure and got none. */
  unfilled: { ref: string; caption: string }[];
  /** Statement lines the sheet has nowhere to put. */
  unplaced: Line[];
};

/**
 * Match by caption: exactly where the wording agrees, else where one caption
 * begins with the other ("OAP CARD" takes the statement's "OAP", "LOF SUGAR
 * CARD" takes "LOF SUGAR"). Never on position, and never on a guess: a short
 * caption is not allowed to swallow a longer one it merely shares a prefix
 * with, or "AAY CARD" would eat "AAY FRK".
 */
export function fillByCaption(sheet: TemplateSheet, lines: Line[]): Filled {
  const values: Values = {};
  const unfilled: { ref: string; caption: string }[] = [];
  const used = new Set<number>();

  const captioned = Object.entries(sheet.cells)
    .filter(([, c]) => c.kind === 'data' && c.p)
    .sort(([a], [b]) => cellOrder(a) - cellOrder(b));

  for (const [ref, cell] of captioned) {
    const want = captionKey(cell.p!);
    let hit = lines.findIndex((l, i) => !used.has(i) && captionKey(l.label) === want);
    if (hit < 0) {
      hit = lines.findIndex((l, i) => {
        if (used.has(i)) return false;
        const got = captionKey(l.label);
        // One must begin with the other, and the shorter must be a real
        // caption rather than a two-letter coincidence.
        return got.length >= 3 && want.length >= 3 && (want.startsWith(got) || got.startsWith(want));
      });
    }
    if (hit < 0) {
      // The same slot, worded differently. "NAME OF THE P.K.R" on the office's
      // CRS 19 sheet and "NAME OF THE B.C" on ours are both the line for the
      // member of staff who signs — the shop decides which of them it is, and
      // the sheet's caption is the office's to word.
      hit = lines.findIndex((l, i) => !used.has(i) && SAME_SLOT.some((r) => r.test(cell.p!) && r.test(l.label)));
    }
    if (hit < 0) {
      unfilled.push({ ref, caption: cell.p! });
      continue;
    }
    used.add(hit);
    values[ref] = lines[hit].value;
  }

  return { values, unfilled, unplaced: lines.filter((_, i) => !used.has(i)) };
}

/** Row-major order, so captions are matched down the sheet as it reads. */
function cellOrder(ref: string): number {
  const row = Number(ref.replace(/\D+/g, ''));
  const col = [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
  return row * 1000 + col;
}

/** The statement sections that have a sheet in the office's workbook. */
export const SHEET_FOR: Record<string, string> = {
  crs_page1: 'CRS PAGE1',
  receipt: 'RECEIPT',
  crs_daily_sale: 'CRS DAILY SALE',
  crs_page2: 'CRS PAGE2 ',
  gunny: 'GUNNY 2',
  free_com: 'FREE COM',
  cost_com: 'COST COM',
  crs_police: 'CRS POLICE',
  remittance: 'REMITTANCE - 2',
  coll: 'Coll',
  sale_tax: 'sale tax',
  b6: 'B6 - 2',
  card_details: 'CARD DETAIL - 2',
  rbi: 'RBI',
};

// ── Tables: row by label, column by heading ─────────────────────────────────

/**
 * A tabular sheet, filled the same way — by what the office wrote, never by
 * position — but in two directions: a figure goes into the template cell
 * whose ROW carries the same label as the statement's row (the commodity,
 * "G.TOTAL") and whose COLUMN sits under the same heading ("O.B", "SALES",
 * "C.B"). A figure the template has no row or no column for is reported, not
 * squeezed in somewhere near.
 *
 * Our statement's own serial numbers are left alone: the template numbers its
 * rows itself, and "5" is the fifth row whichever commodity sits there.
 */
export function fillByTable(sheet: TemplateSheet, html: string): Filled {
  const values: Values = {};
  const unplaced: Line[] = [];
  const grid = parseStatement(html);

  // Our statement's table: the heading row is the one that names the most
  // headings the template also has.
  const templateHeads = headingsOf(sheet);
  const logical = grid.rows.map(expandRow);
  let headAt = -1;
  let best = 0;
  logical.forEach((row, i) => {
    const hits = row.filter((t) => t && templateHeads.has(captionKey(t))).length;
    if (hits > best) {
      best = hits;
      headAt = i;
    }
  });
  if (headAt < 0 || best < 2) return { values, unfilled: [], unplaced };
  const ourHeads = logical[headAt].map((t) => captionKey(t));

  // The template's rows, by the label they carry.
  const rowByLabel = new Map<string, number>();
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (cell.kind !== 'static' || !cell.v) continue;
    const key = captionKey(cell.v);
    if (key && !templateHeads.has(key) && !rowByLabel.has(key)) rowByLabel.set(key, rowOf(ref));
  }

  for (let i = headAt + 1; i < logical.length; i++) {
    const row = logical[i];
    // The row's label: the first cell whose text the template also uses as a
    // row label — the commodity, or "G.TOTAL".
    let tRow: number | undefined;
    for (const t of row) {
      const r = rowByLabel.get(captionKey(t));
      if (r !== undefined) {
        tRow = r;
        break;
      }
    }
    if (tRow === undefined) continue;
    row.forEach((text, c) => {
      const head = ourHeads[c];
      if (!text || !head || head === 'SINO' || head === 'SLNO') return;
      // A row's own label ("B.R.A", "G.TOTAL") says which row this is; it is
      // not a figure, and the form already prints it in its own place.
      if (rowByLabel.has(captionKey(text))) return;
      const tCol = templateHeads.get(head);
      if (tCol === undefined) {
        if (!rowByLabel.has(captionKey(text))) unplaced.push({ label: `${logical[headAt][c]} (row ${i})`, value: text });
        return;
      }
      const ref = `${colLetterOf(tCol)}${tRow}`;
      const target = sheet.cells[ref];
      // Only into a cell the form leaves for a figure — never over its words.
      if (target && target.kind === 'static' && target.v) return;
      values[ref] = /^-?[\d,]+(\.\d+)?$/.test(text) ? Number(text.replace(/,/g, '')) : text;
    });
  }

  // The title lines above the table — "POLICE RECEIPT FOR THE MONTH OF …",
  // "CRS.…" — carry this month's business after the form's own words.
  fillTitles(sheet, grid, values);

  const unfilled = Object.entries(sheet.cells)
    .filter(([ref, c]) => c.kind === 'data' && !(ref in values) && !c.f)
    .map(([ref, c]) => ({ ref, caption: c.p ?? '' }));
  return { values, unfilled, unplaced };
}

/**
 * A captioned cell outside the table takes what follows the SAME words in one
 * of the statement's own lines: "POLICE RECEIPT FOR THE MONTH OF " + the line
 * "POLICE RECEIPT FOR THE MONTH OF SEPTEMBER'2026" gives "SEPTEMBER'2026".
 * Spacing and case are ignored when comparing; nothing is written unless every
 * word of the caption is found at the start of the line.
 */
function fillTitles(sheet: TemplateSheet, grid: ReturnType<typeof parseStatement>, values: Values): void {
  const lines = grid.rows.flatMap((row) => row.flatMap((c) => c.text.split('\n'))).map((t) => t.trim()).filter(Boolean);
  const used = new Set<number>();
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (cell.kind !== 'data' || !cell.p || ref in values) continue;
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const rest = afterCaption(lines[i], cell.p);
      if (rest === null || rest === '') continue;
      values[ref] = rest;
      used.add(i);
      break;
    }
  }
}

/** What follows `caption` at the start of `line`, or null if it does not start with it. */
export function afterCaption(line: string, caption: string): string | null {
  const want = caption.replace(/\s+/g, '').toUpperCase();
  if (!want) return null;
  let i = 0;
  let matched = 0;
  while (i < line.length && matched < want.length) {
    const ch = line[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch.toUpperCase() !== want[matched]) return null;
    matched++;
    i++;
  }
  return matched === want.length ? line.slice(i).trim() : null;
}

/** The template's column headings: heading text → column number. */
function headingsOf(sheet: TemplateSheet): Map<string, number> {
  // The heading row is the static row naming the most columns.
  const byRow = new Map<number, [string, number][]>();
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (cell.kind !== 'static' || !cell.v) continue;
    const r = rowOf(ref);
    byRow.set(r, [...(byRow.get(r) ?? []), [captionKey(cell.v), colOf(ref)]]);
  }
  let best: [string, number][] = [];
  for (const entries of byRow.values()) if (entries.length > best.length) best = entries;
  return new Map(best.filter(([k]) => k));
}

/** A parsed row with each cell repeated across the columns it spans. */
function expandRow(row: ReturnType<typeof parseStatement>['rows'][number]): string[] {
  const out: string[] = [];
  for (const c of row) for (let i = 0; i < c.colspan; i++) out.push(i === 0 ? c.text.replace(/\n/g, ' ').trim() : '');
  return out;
}

const rowOf = (ref: string) => Number(ref.replace(/[^0-9]/g, ''));
const colOf = (ref: string) => ref.replace(/[0-9]/g, '').split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
const colLetterOf = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

// ── The office's own formulas, worked out for display ───────────────────────

/**
 * What the sheet's formulas come to, for the cells the statement left to them.
 *
 * The exported workbook keeps the office's formulas (`I7 = G7*H7`,
 * `I12 = SUM(I7:I10)`) and Excel works them out when it opens the file. The
 * preview has no Excel, so it would show those cells blank where the file
 * shows 0.00 — two different documents. This works the same formulas out from
 * the same figures, so the preview shows what the file will.
 *
 * Deliberately small: cell references, numbers, + − × ÷, brackets and
 * SUM(range) — which is all these sheets use on their own page. A formula
 * reaching into another sheet (`RECEIPT!E15`), or anything else, is left
 * alone rather than guessed at.
 */
export function evaluateFormulas(sheet: TemplateSheet, values: Values): Values {
  const out: Values = {};
  const read = (ref: string): number | null => {
    const v = ref in out ? out[ref] : values[ref];
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const pending = Object.entries(sheet.cells).filter(([ref, c]) => c.f && !c.f.includes('!') && !(ref in values));
  // A few passes, so a total that sums other formula cells sees their results.
  for (let pass = 0; pass < 4; pass++) {
    for (const [ref, c] of pending) {
      const v = evalFormula(c.f!, read);
      if (v !== null) out[ref] = Math.round(v * 1e6) / 1e6;
    }
  }
  return out;
}

function evalFormula(src: string, read: (ref: string) => number | null): number | null {
  const s = src.replace(/\$/g, '').replace(/\s+/g, '').toUpperCase();
  let i = 0;
  const peek = () => s[i];
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[i++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : r === 0 ? 0 : v / r;
    }
    return v;
  };
  const factor = (): number | null => {
    if (peek() === '-') {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') return null;
      i++;
      return v;
    }
    const rest = s.slice(i);
    const sum = rest.match(/^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/);
    if (sum) {
      i += sum[0].length;
      let t = 0;
      const [c1, c2] = [colOf(sum[1]), colOf(sum[3])].sort((a, b) => a - b);
      const [r1, r2] = [Number(sum[2]), Number(sum[4])].sort((a, b) => a - b);
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const v = read(`${colLetterOf(c)}${r}`);
          if (v === null) return null;
          t += v;
        }
      return t;
    }
    const ref = rest.match(/^([A-Z]+)(\d+)/);
    if (ref) {
      i += ref[0].length;
      return read(ref[0]);
    }
    const num = rest.match(/^\d+(\.\d+)?/);
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    return null;
  };
  const v = expr();
  return i === s.length ? v : null;
}

/**
 * How each section's figures are placed in the office's sheet: by caption
 * (a list of "CAPTION : entry" lines, CRS PAGE 1) or by table (rows of labels
 * against column headings, CRS POLICE). A section not listed keeps its current
 * rendering rather than being half-filled.
 */
export const TEMPLATE_FILL: Record<string, 'caption' | 'table'> = {
  crs_page1: 'caption',
  crs_police: 'table',
};

/** Sections drawn on the office's own sheet. */
export const CAPTION_FILLED = new Set(Object.keys(TEMPLATE_FILL));

/** Fill a section's sheet by whichever rule it uses. */
export function fillSection(sectionId: string, sheet: TemplateSheet, html: string): Filled {
  return TEMPLATE_FILL[sectionId] === 'table' ? fillByTable(sheet, html) : fillByCaption(sheet, linesOf(html));
}
