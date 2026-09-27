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
  /**
   * Inches, for the printed page / PDF only, where it must differ from the
   * workbook's (which the Excel export keeps). See `paperMargins`.
   */
  paper?: { left: number; right: number; top: number; bottom: number };
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
  // Free Com and Cost Com: the workbook's right margin is 0 — Excel's "printer
  // minimum", but on the printed page the paper's edge, so both ran to 297.1 mm
  // of 297 and CLOSING BALANCE, CRS NO and AREA SUPERVISOR were cut off (office,
  // 2026-09-27). Printed, each is centred between equal margins instead:
  // - Cost Com keeps its printable width (18.0 mm of margin, now 9 + 9), so the
  //   table is the same size and simply moves 9 mm to the left;
  // - Free Com had only 3.4 mm of margin in all, so there is no room to move it:
  //   5 + 5 mm (as Remittance) makes it 6.6 mm (2.2%) narrower.
  // The Excel export keeps the office's own margins.
  free_com: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.135, 0, 0.748, 0.748), centred: false, paper: M(0.197, 0.197, 0.748, 0.748) },
  cost_com: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.709, 0, 0.748, 0.748), centred: false, paper: M(0.3545, 0.3545, 0.748, 0.748) },
  // The office prints this one at 145%, not fitted — it is a short sheet and
  // they want it to fill the page.
  crs_police: { orientation: 'landscape', scale: 145, fitToPage: false, margins: M(0.25, 0.25, 0.25, 0), centred: true },
  // The workbook's right margin is 0 — in Excel that means "the printer's
  // own minimum", but as a CSS page margin it means the paper's edge, so the
  // table ran to 208.5 mm of 210 and printers cut off TOTAL AMOUNT and the
  // signature (office, 2026-09-27). The right margin is the left one, 5 mm,
  // so the sheet is centred with room on both sides.
  remittance: { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(0.197, 0.197, 0.512, 0.512), centred: true },
  coll: { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(0.512, 0.236, 0.512, 0.236), centred: false },
  sale_tax: { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(1.181, 0.709, 0.748, 0.748), centred: true },
  // B6: the same fault as Cost Com — 17.1 mm on the left, 0 on the right, so
  // the table ran to the paper's edge (office, 2026-09-27). Printed, the same
  // 17.1 mm is split evenly: same size, 8.55 mm further left.
  b6: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.673, 0, 0.21, 0.045), centred: false, paper: M(0.3365, 0.3365, 0.21, 0.045) },
  card_details: { orientation: 'landscape', scale: 100, fitToPage: true, margins: M(0.276, 0.189, 0.748, 0.748), centred: false },
  // Printed at 120%, not fitted.
  rbi: { orientation: 'landscape', scale: 120, fitToPage: false, margins: M(0.709, 0.709, 0.748, 0.748), centred: false },
};

/** What the office's workbook says, or portrait as a last resort. */
export function printFor(sectionId: string): SheetPrint {
  return TEMPLATE_PRINT[sectionId] ?? { orientation: 'portrait', scale: 100, fitToPage: true, margins: M(0.25, 0.25, 0.25, 0.25), centred: false };
}

/** The margins of the PRINTED page (and PDF): `paper` where set, else the workbook's. */
export function paperMargins(sectionId: string): SheetPrint['margins'] {
  const p = printFor(sectionId);
  return p.paper ?? p.margins;
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
 *
 * COLL joined them the same day (a short report on a portrait page, its
 * signature line taken off).
 */
const STRETCH_TO_PAGE = new Set(['remittance', 'sale_tax', 'coll']);
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
  const m = paperMargins(sectionId);
  const w = paper.w - side(m.left) - side(m.right);
  const h = paper.h - side(m.top) - side(m.bottom);
  return { w: Math.floor(w * PX_PER_MM), h: Math.floor(h * PX_PER_MM) };
}
