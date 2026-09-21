/**
 * How the office's own workbook prints each statement.
 *
 * Taken from `CRS 19 AUG'26.xlsx` — the master template — by reading each
 * sheet's `<pageSetup>`, `<pageMargins>` and `<printOptions>` (the settings
 * Excel applies on Ctrl+P). Re-read them with:
 *
 *     node tools/read-template-pagesetup.mjs "<path to the workbook>"
 *
 * These REPLACE the guess this file used to make. Orientation was worked out
 * by counting columns, which happened to agree with the office everywhere,
 * but "happened to agree" is not a reason: the sheet says what it is. Scale
 * and margins were not reproduced at all.
 *
 * Paper is A4 (`paperSize="9"`) on every sheet.
 */

export type SheetPrint = {
  orientation: 'portrait' | 'landscape';
  /** Excel's own print scale, as a percentage. 100 unless the office set one. */
  scale: number;
  /** Excel's "fit to 1 page wide / 1 tall" — set instead of a scale on most sheets. */
  fitToPage: boolean;
  /** Inches, as the workbook stores them. */
  margins: { left: number; right: number; top: number; bottom: number };
  /** The office centres several sheets across the page. */
  centred: boolean;
};

const M = (left: number, right: number, top: number, bottom: number) => ({ left, right, top, bottom });

/**
 * By statement section id. Sheet names in the workbook differ slightly from
 * ours (`GUNNY 2`, `B6 - 2`, `CARD DETAIL - 2`, `REMITTANCE - 2`, `Coll`).
 */
export const TEMPLATE_PRINT: Record<string, SheetPrint> = {
  // CRS PAGE1 — the only portrait sheet with a wide left margin.
  crs_page1: { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(0.984, 0.984, 0.984, 0.236), centred: true },
  receipt: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.197, 0.058, 0.512, 0), centred: false },
  crs_daily_sale: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0, 0, 0.236, 0.197), centred: true },
  crs_page2: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.512, 0.236, 0.512, 0), centred: true },
  gunny: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0, 0, 0.984, 0.512), centred: true },
  free_com: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.135, 0, 0.748, 0.748), centred: false },
  cost_com: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.709, 0, 0.748, 0.748), centred: false },
  // The office prints this one at 145%, not fitted — it is a short sheet and
  // they want it to fill the page.
  crs_police: { orientation: 'landscape', scale: 145, fitToPage: false, margins: M(0.25, 0.25, 0.25, 0), centred: true },
  remittance: { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(0.197, 0, 0.512, 0.512), centred: true },
  coll: { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(0.512, 0.236, 0.512, 0.236), centred: false },
  sale_tax: { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(1.181, 0.709, 0.748, 0.748), centred: true },
  b6: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.673, 0, 0.21, 0.045), centred: false },
  card_details: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.276, 0.189, 0.748, 0.748), centred: false },
  // Printed at 120%, not fitted.
  rbi: { orientation: 'landscape', scale: 120, fitToPage: false, margins: M(0.709, 0.709, 0.748, 0.748), centred: false },
};

/** What the office's workbook says, or portrait as a last resort. */
export function printFor(sectionId: string): SheetPrint {
  return TEMPLATE_PRINT[sectionId] ?? { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(0.25, 0.25, 0.25, 0.25), centred: false };
}

/** Does the workbook say how this statement prints? */
export const inTemplate = (sectionId: string): boolean => sectionId in TEMPLATE_PRINT;

const MM_PER_INCH = 25.4;
/** A margin in millimetres, for CSS. */
export const mm = (inches: number): number => Math.round(inches * MM_PER_INCH * 100) / 100;

/**
 * Does the office ENLARGE this sheet to fill its page?
 *
 * Two of the workbook's sheets are printed at a fixed scale above 100% rather
 * than "fit to page": CRS Police at 145% and RBI at 120%. They are short
 * statements, and the office blows them up so they fill the paper instead of
 * sitting small in the top half of it. Every other sheet is fit-to-page, which
 * in Excel only ever SHRINKS — so those are left at their own size.
 */
export function fillsPage(sectionId: string): boolean {
  const p = TEMPLATE_PRINT[sectionId];
  return (!!p && !p.fitToPage && p.scale > 100) || stretchesToPage(sectionId);
}

/**
 * Statements whose ROWS grow until the table reaches the foot of the page.
 *
 * Remittance and Sale Tax are portrait and fit to page, which in Excel only
 * ever shrinks — so a month's rows stopped two-thirds of the way down, and
 * the office asked for the sheet to fill the page (2026-09-21). Each is first
 * enlarged as far as the printable width allows, as Police is (Sale Tax has
 * room; Remittance is already as wide as the paper); whatever height is then
 * left goes into the main table's ROWS — the same figures in the same cells,
 * on taller ruled lines, as a hand-ruled form would be.
 */
const STRETCH_TO_PAGE = new Set(['remittance', 'sale_tax']);
export const stretchesToPage = (sectionId: string): boolean => STRETCH_TO_PAGE.has(sectionId);

const PX_PER_MM = 96 / 25.4;
/** The preview draws every sheet with 8 mm of paper around it. */
const SCREEN_MARGIN_MM = 8;

/**
 * The room a statement has on its page, in CSS pixels.
 *
 * Taken as the tighter of the office's own print margins and the preview's
 * 8 mm, per side, so a statement enlarged to fill it fits both on screen and on
 * the printed sheet — the two must never show a different page.
 */
export function printableBoxPx(sectionId: string): { w: number; h: number } {
  const p = printFor(sectionId);
  const paper = p.orientation === 'landscape' ? { w: 297, h: 210 } : { w: 210, h: 297 };
  const side = (inches: number) => Math.max(mm(inches), SCREEN_MARGIN_MM);
  const w = paper.w - side(p.margins.left) - side(p.margins.right);
  const h = paper.h - side(p.margins.top) - side(p.margins.bottom);
  return { w: Math.floor(w * PX_PER_MM), h: Math.floor(h * PX_PER_MM) };
}
