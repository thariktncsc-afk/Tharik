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
 * HOW EACH STATEMENT PRINTS COMES FROM THE OFFICE'S OWN WORKBOOK
 * (`pageSetup.ts`, read from `CRS 19 AUG'26.xlsx`): orientation, margins and
 * centring, sheet by sheet. That workbook is the master, so it decides —
 * measuring the statement's width is only the fallback for a section it has no
 * sheet for.
 *
 * SCALE. The office prints CRS Police at 145% and RBI at 120% so those short
 * statements fill the paper; every other sheet is fit-to-page, which only
 * ever shrinks. The percentages themselves are not copied — they were set for
 * the office's grid, and our HTML is drawn at a different size — but the
 * effect is: those two are enlarged to fill their printable area, width and
 * height both (`sheetBody` + fillPage.ts). The rest print at their own size.
 */

import { parseStatement } from '@/lib/statements/sheetModel';
import { fillsPage, inTemplate, mm, printFor, printableBoxPx } from '@/lib/statements/pageSetup';
import { FILL_SCRIPT } from '@/lib/statements/fillPage';
import TEMPLATE from '@/generated/statement-template.json';
import { CAPTION_FILLED, SHEET_FOR, evaluateFormulas, fillSection } from '@/lib/statements/templateFill';
import { TEMPLATE_CSS, pageCssFor, renderSheet, type TemplateModel } from '@/lib/statements/templateRender';

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

/** A CSS @page name for a section id (letters only: `crs_page1` → `stmtcrspage1`). */
const pageName = (id: string) => 'stmt' + id.replace(/[^a-z0-9]/gi, '');

/** A4, in millimetres, for a section the workbook has no sheet for. */
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
 * How this statement prints.
 *
 * The office's own workbook decides, sheet by sheet (`pageSetup.ts`, read from
 * `CRS 19 AUG'26.xlsx`): that is the master, and it states orientation,
 * margins, scale and centring for each one. Measuring the statement's width is
 * only the fallback, for a section the workbook has no sheet for.
 */
export function orientationOf(html: string, sectionId?: string): 'portrait' | 'landscape' {
  if (sectionId && inTemplate(sectionId)) return printFor(sectionId).orientation;
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
export function pageCss(sectionIds: string[] = []): string {
  // A named page per section the workbook covers, carrying that sheet's own
  // margins and centring, so a statement prints on the paper the office set
  // for it rather than on one house style.
  const perSection: string[] = [];
  for (const id of new Set(sectionIds)) {
    if (!inTemplate(id)) continue;
    const p = printFor(id);
    perSection.push(`@page ${pageName(id)}{size:A4 ${p.orientation};margin:${mm(p.margins.top)}mm ${mm(p.margins.right)}mm ${mm(p.margins.bottom)}mm ${mm(p.margins.left)}mm}`);
    perSection.push(`.stmt-sheet[data-section="${id}"]{page:${pageName(id)}${p.centred ? ';margin-left:auto;margin-right:auto' : ''}}`);
  }
  return [
    // Named pages: one for each orientation, for anything the workbook has no
    // sheet for; the per-section rules below override them where it does.
    `@page stmtP{size:A4 portrait;margin:${MARGIN_MM}mm}`,
    `@page stmtL{size:A4 landscape;margin:${MARGIN_MM}mm}`,
    '.stmt-sheet--portrait{page:stmtP}',
    '.stmt-sheet--landscape{page:stmtL}',
    ...perSection,
    // One statement, one sheet. The last one takes no break after it, or every
    // print job ends on a blank page.
    '.stmt-sheet{break-after:page;page-break-after:always;break-inside:auto}',
    '.stmt-sheet:last-child{break-after:auto;page-break-after:auto}',
    '.stmt-doc>.stmt-sheet:last-child,.stmt-doc>.tpl-sheet:last-child{break-after:auto;page-break-after:auto}',
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

/**
 * A statement's markup, ready for its sheet. The two the office enlarges
 * (CRS Police, RBI) are wrapped so `fillSheets` can size them to fill the
 * page; the room they have is stated on the wrapper, from the office's own
 * margins, so the same figure is used on screen and on paper.
 */
export function sheetBody(html: string, sectionId?: string): string {
  if (!sectionId || !fillsPage(sectionId)) return html;
  const box = printableBoxPx(sectionId);
  return `<div class="stmt-fill" data-fill-w="${box.w}" data-fill-h="${box.h}">${html}</div>`;
}

/** One sheet: the statement's own HTML, wrapped so it owns a page. */
function sheet(section: PrintSection, copy: number, copies: number): string {
  // Where the office's own sheet is drawn for the preview, PRINT draws the
  // same sheet — otherwise the preview and the PDF are two documents.
  const office = templateSheetPreview(section.id, section.html);
  if (office) return office;
  const orient = orientationOf(section.html, section.id);
  const label = copies > 1 ? `${section.label} (copy ${copy} of ${copies})` : section.label;
  return (
    `<div class="stmt-sheet stmt-sheet--${orient}" data-section="${section.id}" data-copy="${copy}" aria-label="${label}">` +
    sheetBody(section.html, section.id) +
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
    // Wrapped, so "the last sheet" is the last sheet and not the <style>
    // and <script> that follow it — otherwise every sheet, the last one
    // included, takes a page break after it.
    `<main class="stmt-doc">${sheets}</main>` +
    // Last, so these page rules win over the ones a builder carries — and
    // carrying each section's own page setup from the office's workbook.
    `<style>${pageCss(sections.map((s) => s.id))}</style>` +
    // Size the statements the office enlarges to fill their page, before the
    // print dialog opens (it is opened 600 ms after the window is written).
    (sections.some((s) => fillsPage(s.id)) ? `<script>${FILL_SCRIPT}</script>` : '') +
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
  // Where the office's workbook has the sheet and this statement's figures can
  // be placed in it, the preview IS that sheet — the same page the export
  // writes, so the two cannot show different documents.
  const office = sectionId ? templateSheetPreview(sectionId, html) : null;
  if (office) return office;
  return (
    `<style>${pageCss(sectionId ? [sectionId] : [])}</style>` +
    `<div class="stmt-sheet stmt-sheet--${orientationOf(html, sectionId)}" data-section="${sectionId ?? ''}">${sheetBody(html, sectionId)}</div>`
  );
}

/**
 * This statement drawn on the office's own sheet, where the workbook has one
 * and the figures can be placed in it by caption — otherwise null, and the
 * statement is shown as our own markup.
 */
export function templateSheetPreview(sectionId: string, html: string): string | null {
  const name = SHEET_FOR[sectionId];
  if (!name || !CAPTION_FILLED.has(sectionId)) return null;
  const model = TEMPLATE as unknown as TemplateModel;
  const sheet = model.sheets.find((s) => s.name === name);
  if (!sheet) return null;
  const { values } = fillSection(sectionId, sheet, html);
  // What the office's own formulas come to — the exported file keeps the
  // formulas and Excel works them out, so the page shows the same results.
  const shown = { ...evaluateFormulas(sheet, values), ...values };
  const pageId = 'tpl' + sectionId.replace(/[^a-z0-9]/gi, '');
  return `<style>${TEMPLATE_CSS}
${pageCssFor(sheet, pageId)}</style>` + renderSheet(model, sheet, shown, pageId, { fill: fillsPage(sectionId) });
}

/** How many sheets a selection prints — one per copy, in order. */
export function sheetCount(sections: PrintSection[]): number {
  return sections.reduce((n, s) => n + Math.max(1, Math.floor(s.copies) || 1), 0);
}
