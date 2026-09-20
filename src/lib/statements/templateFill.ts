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

/**
 * Sheets whose figures are placed by caption alone.
 *
 * CRS PAGE 1 is a list of captions and entries, so caption matching states the
 * whole sheet. The tabular sheets — a grid of commodities against stages —
 * carry their captions in the headings rather than beside each figure, and
 * need their own mapping; until one is written they keep the current
 * rendering rather than being half-filled.
 */
export const CAPTION_FILLED = new Set(['crs_page1']);
