/**
 * Rows the office's workbook does not have, added to its sheet at use.
 *
 * `statement-template.json` is the office's `CRS 19 AUG'26.xlsx` as extracted
 * — re-running the extractor must not lose anything added since — so the
 * additions live here, in code, applied every time the sheet is looked up
 * (`officeSheet`). Everything the office drew stays exactly where it was.
 *
 * CRS PAGE1 (office request 2026-09-21: every card category and every
 * allotment commodity must appear):
 *   - LOF AAY CARD and TOTAL CARD DETAILS under the office's eight card rows;
 *     without the first, a LOF AAY count was counted in the total and shown
 *     nowhere.
 *   - Allotment lines 6 and 7 beside card rows 14–15, in the office's own
 *     shorthand. (An 8.OAP&APS line was added and then taken off again at
 *     the office's request — OAP and APS have no line on Page 1.)
 *   - The NOTE block moves down two rows and two of the five empty spacer
 *     rows above the signatures are dropped, so the signature rows keep their
 *     numbers and the page grows by about half a line.
 */
import TEMPLATE from '@/generated/statement-template.json';
import type { TemplateCell, TemplateModel, TemplateSheet } from '@/lib/statements/templateRender';
import { SHEET_FOR } from '@/lib/statements/templateFill';

const rowOf = (ref: string) => Number(ref.replace(/^[A-Z]+/, ''));
const colOf = (ref: string) => ref.replace(/\d+$/, '');

/**
 * A copy of `sheet` with its rows renumbered by `map` (old row → new row, or
 * null to drop it). Cells, row heights and merges all move together.
 */
export function remapRows(sheet: TemplateSheet, map: (row: number) => number | null): TemplateSheet {
  const cells: Record<string, TemplateCell> = {};
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const to = map(rowOf(ref));
    if (to !== null) cells[`${colOf(ref)}${to}`] = { ...cell };
  }
  const rows: Record<string, number> = {};
  for (const [r, h] of Object.entries(sheet.rows)) {
    const to = map(Number(r));
    if (to !== null) rows[String(to)] = h;
  }
  const merges: string[] = [];
  for (const m of sheet.merges) {
    const [a, b] = m.split(':');
    const ta = map(rowOf(a));
    const tb = map(rowOf(b));
    if (ta !== null && tb !== null) merges.push(`${colOf(a)}${ta}:${colOf(b)}${tb}`);
  }
  let maxRow = 0;
  for (let r = 1; r <= sheet.maxRow; r++) {
    const to = map(r);
    if (to !== null) maxRow = Math.max(maxRow, to);
  }
  return { ...sheet, cells, rows, merges, maxRow };
}

/** The Page 1 card rows, top to bottom, as the statement names them. */
export const PAGE1_CARD_CAPTIONS = [
  'RICE CARD', 'SUGAR CARD', 'AAY CARD', 'LOF RICE CARD', 'POLICE CARD',
  "N' CARD", 'LOF SUGAR CARD', 'OAP CARD', 'LOF AAY CARD', 'TOTAL CARD DETAILS',
] as const;

/** The Page 1 allotment lines, as the statement names them. 1–5 are the office's. */
export const PAGE1_ALLOT_CAPTIONS = [
  '1.RICE&AAY', '2.SUGAR&AAY', '3.WHEAT', '4.T.D & P.O', '5.PHH BRA&FRK',
  '6.NPHH&AAY FRK', '7.RRA&NPHH RRA',
] as const;

function amendPage1(sheet: TemplateSheet): TemplateSheet {
  // Rows 1–16 stay; 17–20 (spacer, NOTE, the two notes) move down two; the
  // first two of the empty spacers 21–25 go; 23 onwards keep their numbers.
  const out = remapRows(sheet, (r) => (r <= 16 ? r : r <= 20 ? r + 2 : r <= 22 ? null : r));
  const cardStyle = sheet.cells.B16?.s ?? sheet.cells.B9.s;
  const allotStyle = sheet.cells.C13?.s ?? sheet.cells.C9.s;
  const lineH = sheet.rows['13'] ?? 21;

  out.cells.B17 = { s: cardStyle, kind: 'data', p: 'LOF AAY CARD      : ' };
  out.cells.B18 = { s: cardStyle, kind: 'data', p: 'TOTAL CARD DETAILS : ' };
  out.cells.C14 = { s: allotStyle, kind: 'data', p: '6.NPHH&AAY FRK   : ' };
  out.cells.C15 = { s: allotStyle, kind: 'data', p: '7.RRA&NPHH RRA   : ' };
  // Every card and allotment line on a row tall enough for its 14–18 pt type.
  for (const r of [15, 16, 17, 18]) out.rows[String(r)] = lineH;
  // Lines 6 and 7 span C:D as lines 1–4 do.
  out.merges.push('C14:D14', 'C15:D15');
  return out;
}

/**
 * Page 1's staff lines, per shop, by ROLE (office, 2026-09-21).
 *
 * The office's form has one name line — worded "NAME OF THE P.K.R" because
 * CRS 19's staff member is a Packer — and one "SIGNATURE OF B.C" / "MOBILE NO"
 * block, so drawn as it stands it gave every shop a P.K.R at the top and a
 * B.C at the foot. The statement (43-staff-posts.js) names the shop's actual
 * posts from the users table; this makes the form say the same:
 *   - one post  → the name and signature captions name that post;
 *   - both      → a second name line under the first, and a second signature +
 *                 mobile block under the first, B.C before P.K.R as the
 *                 statement lists them;
 *   - neither   → no name, signature or mobile line at all.
 * Which posts the shop has is read from the statement's own lines, so the
 * form cannot disagree with the statement it is filled from.
 */
function page1Staff(base: TemplateSheet, html: string): TemplateSheet {
  const text = html.replace(/<[^>]*>/g, ' ');
  const posts = [...text.matchAll(/NAME OF THE\s+(B\.C|P\.K\.R)\s*:/g)].map((m) => m[1]);
  const sheet: TemplateSheet = { ...base, cells: { ...base.cells }, rows: { ...base.rows }, merges: [...base.merges] };
  const blank = (ref: string) => {
    const c = sheet.cells[ref];
    if (c) sheet.cells[ref] = { s: c.s, kind: 'static' };
  };
  const caption = (ref: string, p: string) => {
    const c = sheet.cells[ref];
    if (c) sheet.cells[ref] = { ...c, p };
  };

  if (posts.length === 0) {
    blank('B6');
    blank('B26');
    blank('B27');
    return sheet;
  }
  if (posts.length === 1) {
    caption('B6', `NAME OF THE ${posts[0]}: `);
    caption('B26', `SIGNATURE OF ${posts[0]} :`);
    return sheet;
  }

  // Both. A name row goes in under row 6; two of the spacer rows above the
  // signatures come out to pay for it and for the second signature block,
  // which goes under the first. The page grows by about one line.
  const out = remapRows(sheet, (r) =>
    r <= 6 ? r : r <= 22 ? r + 1 : r === 23 || r === 24 ? null : r <= 27 ? r - 1 : r + 1,
  );
  const [first, second] = posts;
  out.cells.B6 = { ...sheet.cells.B6, p: `NAME OF THE ${first}: ` };
  out.cells.B7 = { ...sheet.cells.B6, p: `NAME OF THE ${second}: ` };
  out.rows['7'] = sheet.rows['6'] ?? sheet.defaultRowHeight;
  out.cells.B25 = { ...sheet.cells.B26, p: `SIGNATURE OF ${first} :` };
  out.cells.B26 = { ...sheet.cells.B27 };
  out.cells.B27 = { ...sheet.cells.B26, p: `SIGNATURE OF ${second} :` };
  out.cells.B28 = { ...sheet.cells.B27 };
  out.rows['27'] = sheet.rows['26'] ?? sheet.defaultRowHeight;
  out.rows['28'] = sheet.rows['27'] ?? sheet.defaultRowHeight;
  return out;
}

/**
 * The office's sheet for this statement as it will be drawn — the fixed
 * additions (`officeSheet`) plus anything that depends on the shop, read from
 * the statement itself. Preview, Print and Excel all come through here.
 */
export function officeSheetFor(sectionId: string, html: string): TemplateSheet | null {
  const sheet = officeSheet(sectionId);
  if (!sheet) return null;
  return sectionId === 'crs_page1' ? page1Staff(sheet, html) : sheet;
}

const AMEND: Record<string, (s: TemplateSheet) => TemplateSheet> = {
  'CRS PAGE1': amendPage1,
};

const cache = new Map<string, TemplateSheet>();

/** The office's sheet for a statement section, with the additions above — or null. */
export function officeSheet(sectionId: string): TemplateSheet | null {
  const name = SHEET_FOR[sectionId];
  if (!name) return null;
  if (cache.has(name)) return cache.get(name)!;
  const model = TEMPLATE as unknown as TemplateModel;
  const raw = model.sheets.find((s) => s.name === name);
  if (!raw) return null;
  const sheet = AMEND[name] ? AMEND[name](raw) : raw;
  cache.set(name, sheet);
  return sheet;
}
