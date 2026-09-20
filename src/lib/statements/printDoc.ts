/**
 * The printable document — what Print, and therefore Save as PDF, produces.
 *
 * The statement builders are unchanged and must stay so: `golden/statements/`
 * holds 306 snapshots of their exact output. Everything here is ASSEMBLY —
 * each section's HTML goes into a sheet of its own, and one stylesheet is
 * appended AFTER every section so the page rules that decide paper size and
 * breaks are the last word.
 *
 * What was wrong before, and what fixes it:
 *
 *   One page, everything on it. The sections were concatenated straight into
 *   the print window. `STMT_PRINT_CSS` does carry a `page-break-after` — on
 *   `.stmt-page`, a class no builder has ever emitted — so nothing ever broke
 *   a page and section ran into section. Each sheet is now wrapped and broken
 *   explicitly, and a `copies: 2` section prints each copy on its own sheet.
 *
 *   A3 landscape for everything. The Daily Sales builder carries
 *   `@media print{@page{size:A3 landscape}}` inside its own <style>, and an
 *   `@page` rule is the document's, not that section's — so one wide section
 *   turned every other statement onto A3 paper, which an A4 printer then
 *   shrinks. Sheets are given NAMED pages here (`@page stmtP` / `stmtL`), and
 *   a named page beats the unnamed rule for the elements that use it.
 *
 *   Everything squeezed. The same block sets `body{font-size:8px}` for print,
 *   which reached every section. The appended sheet puts the body back.
 *
 * Orientation is worked out from the statement itself — how many columns wide
 * it is — so a builder that gains a column keeps printing correctly without
 * anything here being edited. `ALWAYS_LANDSCAPE` is the short list of sheets
 * the office files on their side whatever their width.
 */

import { parseStatement } from '@/lib/statements/sheetModel';

export type PrintSection = { id: string; label: string; copies: number; html: string };

/** More columns than this and the statement is laid on its side. */
export const LANDSCAPE_COLUMNS = 9;

/**
 * Statements the office prints landscape whatever their width.
 *
 * CRS Police, Card Details and RBI are each just under the column count that
 * would turn them by itself, and the office files all three on their side
 * (2026-09-20). Measuring still decides everything else, so a builder that
 * gains a column is still handled without anyone editing this.
 */
export const ALWAYS_LANDSCAPE = new Set(['crs_police', 'card_details', 'rbi']);

/** A4, in millimetres, with the margin the office's filing punch needs. */
const MARGIN_MM = 8;

/**
 * How many columns the widest row of a statement has. Counted from the markup
 * (colgroup first, else the busiest row, colspans included) because that is
 * what decides whether it fits across A4 portrait.
 */
export function columnCount(html: string): number {
  return parseStatement(html).cols;
}

/**
 * Portrait unless the statement is too wide across A4 to stay readable — or
 * it is one of the few the office always files on its side (`sectionId`).
 */
export function orientationOf(html: string, sectionId?: string): 'portrait' | 'landscape' {
  if (sectionId && ALWAYS_LANDSCAPE.has(sectionId)) return 'landscape';
  return columnCount(html) > LANDSCAPE_COLUMNS ? 'landscape' : 'portrait';
}

/**
 * The stylesheet appended after every section.
 *
 * Only page geometry and breaking are set here. Nothing touches a builder's
 * own fonts, borders or column widths — the statements must keep looking
 * exactly as the office knows them.
 */
export function pageCss(): string {
  return [
    // Named pages: one for each orientation, so a wide statement can be laid
    // on its side without taking every other statement with it.
    `@page stmtP{size:A4 portrait;margin:${MARGIN_MM}mm}`,
    `@page stmtL{size:A4 landscape;margin:${MARGIN_MM}mm}`,
    '.stmt-sheet--portrait{page:stmtP}',
    '.stmt-sheet--landscape{page:stmtL}',
    // One statement, one sheet. The last one takes no break after it, or every
    // print job ends on a blank page.
    '.stmt-sheet{break-after:page;page-break-after:always;break-inside:auto}',
    '.stmt-sheet:last-child{break-after:auto;page-break-after:auto}',
    // The builders' own <style> blocks set `body{font-size:8px}` for print
    // between them; put it back so each statement keeps its own sizes.
    '@media print{body{font-size:11px;margin:0;padding:0;background:#fff}}',
    // A statement longer than a page continues onto the next one instead of
    // being shrunk, and its table header is repeated at the top of it.
    'thead{display:table-header-group}',
    'tfoot{display:table-footer-group}',
    'tr{break-inside:avoid;page-break-inside:avoid}',
    // A scroller is a screen idea; on paper it hides the right-hand columns.
    '.stmt-sheet [style*="overflow"],.stmt-sheet div[class$="-scroll"]{overflow:visible!important}',
    // On screen (the print preview window before the dialog opens) the sheets
    // are shown as pages, so what is on the paper is what is on the screen.
    '@media screen{body{background:#E2E8F0;margin:0}',
    `.stmt-sheet{background:#fff;margin:10px auto;padding:${MARGIN_MM}mm;box-sizing:border-box;box-shadow:0 2px 10px rgba(0,0,0,.15)}`,
    '.stmt-sheet--portrait{width:210mm;min-height:297mm}',
    '.stmt-sheet--landscape{width:297mm;min-height:210mm}}',
    '@media print{.stmt-sheet{margin:0;padding:0;box-shadow:none;width:auto;min-height:0}}',
  ].join('\n');
}

/** One sheet: the statement's own HTML, wrapped so it owns a page. */
function sheet(section: PrintSection, copy: number, copies: number): string {
  const orient = orientationOf(section.html, section.id);
  const label = copies > 1 ? `${section.label} (copy ${copy} of ${copies})` : section.label;
  return (
    `<div class="stmt-sheet stmt-sheet--${orient}" data-section="${section.id}" data-copy="${copy}" aria-label="${label}">` +
    section.html +
    '</div>'
  );
}

/**
 * The whole print document: every selected statement, each on its own sheet,
 * every copy of a two-copy statement on a sheet of its own, in the order the
 * office selected them.
 */
export function buildPrintDocument(title: string, baseCss: string, sections: PrintSection[]): string {
  const sheets = sections
    .flatMap((s) => {
      const copies = Math.max(1, Math.floor(s.copies) || 1);
      return Array.from({ length: copies }, (_, i) => sheet(s, i + 1, copies));
    })
    .join('\n');
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"/>' +
    `<title>${title}</title>` +
    `<style>${baseCss}</style>` +
    '</head><body>' +
    sheets +
    // Last, so these page rules win over the ones a builder carries.
    `<style>${pageCss()}</style>` +
    '</body></html>'
  );
}

/**
 * One statement shown as the sheet it will be printed on — the same wrapper
 * and the same page rules, so the preview is the paper: a wide statement like
 * the Receipt is seen landscape, at its real width, rather than squeezed into
 * whatever the screen happens to be.
 */
export function buildPreviewSheet(html: string, sectionId?: string): string {
  return `<style>${pageCss()}</style><div class="stmt-sheet stmt-sheet--${orientationOf(html, sectionId)}">${html}</div>`;
}

/** How many sheets a selection prints — one per copy, in order. */
export function sheetCount(sections: PrintSection[]): number {
  return sections.reduce((n, s) => n + Math.max(1, Math.floor(s.copies) || 1), 0);
}
