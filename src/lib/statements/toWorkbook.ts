/**
 * The Excel export: one .xlsx file, one WORKSHEET per selected statement.
 *
 * What it replaces: every statement's HTML concatenated into a file named
 * `.xls`. Excel read that as a single sheet, the flex-laid-out statements
 * (CRS Page 1 is entirely flex) collapsed into overlapping text, and nothing
 * in it was print-ready. Figures are untouched — the cells hold exactly the
 * text the statement shows, as numbers where the statement shows numbers.
 *
 * Built from the grid in sheetModel.ts, so a statement that prints as a table
 * arrives as a table: merged cells where the statement merges, the statement's
 * own alignment, borders around the table cells and not around its title
 * lines, column widths from the content, and Tamil text kept as text (xlsx is
 * UTF-8 throughout, which the old HTML-in-.xls was not reliably).
 *
 * `xlsx-js-style` writes cells, styles, merges, widths, row heights, margins
 * and defined names, but has no writer for freeze panes or page setup — so
 * the workbook it produces is unzipped and each sheet's XML is given its
 * `<sheetPr>`, `<sheetViews>` and `<pageSetup>` before being zipped again
 * (`applyPrintSetup`). That is the only reason fflate is here.
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
// A CommonJS module: its default export is the namespace, and reaching for a
// named `utils` gets undefined under Node's ESM interop.
import XLSX from 'xlsx-js-style';
import { parseStatement, type Cell, type Grid } from '@/lib/statements/sheetModel';
import { ALWAYS_LANDSCAPE } from '@/lib/statements/printDoc';
import { inTemplate, printFor, type SheetPrint } from '@/lib/statements/pageSetup';
import TEMPLATE from '@/generated/statement-template.json';
import { CAPTION_FILLED, SHEET_FOR, fillByCaption, linesOf } from '@/lib/statements/templateFill';
import { columnWidths as templateColWidths, rowHeights as templateRowHeights, mergeMap, colLetter, type TemplateModel, type TemplateSheet, type Values } from '@/lib/statements/templateRender';

export type ExportSection = { id: string; label: string; html: string };

/** Wider than this and the sheet is printed on its side. */
const LANDSCAPE_COLUMNS = 9;
/** Excel's own limit on a worksheet name. */
const SHEET_NAME_MAX = 31;
const MIN_COL_WIDTH = 8;
const MAX_COL_WIDTH = 42;

export type SheetPlan = {
  name: string;
  grid: Grid;
  widths: number[];
  orientation: 'portrait' | 'landscape';
  /** The office workbook's own page setup for this sheet, where it has one. */
  print: SheetPrint;
  /** Rows to freeze on screen and repeat at the top of every printed page. */
  headerRows: number;
  /** Set when this sheet is the office's own, with figures filled into it. */
  template?: { sheet: TemplateSheet; values: Values; model: TemplateModel };
};

/**
 * A worksheet name Excel will accept: no `[]:*?/\`, 31 characters at most,
 * and never a repeat — two statements called the same thing would otherwise
 * silently become one sheet.
 */
export function sheetName(label: string, taken: Set<string>): string {
  const base = (label.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Statement').slice(0, SHEET_NAME_MAX);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let i = 2; i < 100; i++) {
    const suffix = ` (${i})`;
    const name = base.slice(0, SHEET_NAME_MAX - suffix.length) + suffix;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  taken.add(base);
  return base;
}

/** Column widths from the longest line each column actually holds. */
export function columnWidths(grid: Grid): number[] {
  const widths = new Array(Math.max(1, grid.cols)).fill(MIN_COL_WIDTH);
  for (const row of grid.rows) {
    let c = 0;
    for (const cellOf of row) {
      // A merged cell's text is shared across its columns, so it never decides
      // one column's width on its own.
      const longest = Math.max(...cellOf.text.split('\n').map((l) => l.length), 0);
      const per = Math.ceil(longest / cellOf.colspan) + 2;
      for (let i = 0; i < cellOf.colspan && c + i < widths.length; i++) {
        widths[c + i] = Math.min(MAX_COL_WIDTH, Math.max(widths[c + i], per));
      }
      c += cellOf.colspan;
    }
  }
  return widths;
}

/**
 * One statement's worksheet taken from the office's own sheet: its grid, its
 * styles, its merges, its widths and heights, with this month's figures put in
 * by caption (templateFill.ts).
 *
 * This is what "the workbook is the format" means in the export. Before it,
 * the sheet was rebuilt from our HTML, which for CRS PAGE 1 — laid out in
 * flex, not a table — collapsed into two columns of text.
 */
export function templatePlan(section: ExportSection, taken: Set<string>): SheetPlan | null {
  const officeSheet = SHEET_FOR[section.id];
  if (!officeSheet || !CAPTION_FILLED.has(section.id)) return null;
  const model = TEMPLATE as unknown as TemplateModel;
  const sheet = model.sheets.find((s) => s.name === officeSheet);
  if (!sheet) return null;
  const { values } = fillByCaption(sheet, linesOf(section.html));
  return {
    name: sheetName(section.label, taken),
    grid: { rows: [], cols: sheet.maxCol, headerRows: 0 },
    widths: [],
    orientation: sheet.print.orientation,
    print: printFor(section.id),
    headerRows: 0,
    template: { sheet, values, model },
  };
}

/** Everything about one statement's worksheet, worked out before Excel is involved. */
export function planSheet(section: ExportSection, taken: Set<string>): SheetPlan {
  const grid = parseStatement(section.html);
  // The office workbook's own settings for this sheet where it has them,
  // so the exported file prints as the office's file prints. Measuring the
  // statement's width is only the fallback.
  const print = inTemplate(section.id)
    ? printFor(section.id)
    : {
        ...printFor(section.id),
        orientation: (ALWAYS_LANDSCAPE.has(section.id) || grid.cols > LANDSCAPE_COLUMNS ? 'landscape' : 'portrait') as 'portrait' | 'landscape',
      };
  return {
    name: sheetName(section.label, taken),
    grid,
    widths: columnWidths(grid),
    orientation: print.orientation,
    print,
    headerRows: grid.headerRows,
  };
}

/** Every selected statement, in the order selected, each with its own sheet. */
export function planWorkbook(sections: ExportSection[]): SheetPlan[] {
  const taken = new Set<string>();
  // The office's own sheet where there is one and its figures can be placed;
  // our own grid otherwise.
  return sections.map((s) => templatePlan(s, taken) ?? planSheet(s, taken));
}

// ── The worksheet itself ────────────────────────────────────────────────────

const THIN = { style: 'thin', color: { rgb: '000000' } } as const;
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/** `0.000`, `0.00`, `0` — the decimals the statement itself printed. */
const numFormat = (decimals: number): string => (decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0');

function styleFor(cellOf: Cell, bordered: boolean) {
  return {
    font: { name: 'Calibri', sz: cellOf.header ? 10 : 10, bold: cellOf.bold },
    alignment: {
      horizontal: cellOf.align,
      vertical: 'center',
      wrapText: cellOf.text.includes('\n') || cellOf.text.length > MAX_COL_WIDTH,
    },
    ...(bordered ? { border: BORDER } : {}),
    ...(cellOf.header ? { fill: { fgColor: { rgb: 'F2F2F2' }, patternType: 'solid' } } : {}),
  };
}

/** One statement's grid as a worksheet: cells, merges, widths, row heights. */
export function sheetOf(plan: SheetPlan): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const rowHeights: { hpt: number }[] = [];
  // Cells a merge has already claimed, so the next cell moves past them.
  const claimed = new Set<string>();
  let maxCol = 0;

  plan.grid.rows.forEach((row, r) => {
    let c = 0;
    let lines = 1;
    // A row of a single cell is a title or a signature line — no border box
    // around it, exactly as the statement prints it.
    const bordered = row.length > 1 || row.reduce((t, x) => t + x.colspan, 0) > 1;
    for (const cellOf of row) {
      while (claimed.has(`${r},${c}`)) c++;
      const ref = XLSX.utils.encode_cell({ r, c });
      ws[ref] =
        cellOf.num !== undefined
          ? { t: 'n', v: cellOf.num, z: numFormat(cellOf.decimals ?? 0), s: styleFor(cellOf, bordered) }
          : { t: 's', v: cellOf.text, s: styleFor(cellOf, bordered) };
      if (cellOf.colspan > 1 || cellOf.rowspan > 1) {
        merges.push({ s: { r, c }, e: { r: r + cellOf.rowspan - 1, c: c + cellOf.colspan - 1 } });
        for (let rr = r; rr < r + cellOf.rowspan; rr++) {
          for (let cc = c; cc < c + cellOf.colspan; cc++) {
            if (rr !== r || cc !== c) {
              claimed.add(`${rr},${cc}`);
              // Excel wants the covered cells to exist, or the merge borders break.
              ws[XLSX.utils.encode_cell({ r: rr, c: cc })] = { t: 's', v: '', s: styleFor({ ...cellOf, text: '' }, bordered) };
            }
          }
        }
      }
      lines = Math.max(lines, cellOf.text.split('\n').length);
      c += cellOf.colspan;
      if (c > maxCol) maxCol = c;
    }
    rowHeights.push({ hpt: Math.max(15, lines * 13) });
  });

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, plan.grid.rows.length - 1), c: Math.max(0, maxCol - 1) } });
  ws['!merges'] = merges;
  ws['!cols'] = plan.widths.slice(0, Math.max(1, maxCol)).map((wch) => ({ wch }));
  ws['!rows'] = rowHeights;
  // The office's own margins for this sheet, in inches, from its workbook.
  // (Written again as XML in applyPrintSetup, beside the page setup — this is
  // what the library itself emits, and the two must not disagree.)
  const m = plan.print.margins;
  ws['!margins'] = { left: m.left, right: m.right, top: m.top, bottom: m.bottom, header: 0, footer: 0 };
  return ws;
}

/**
 * The office's sheet as a worksheet: its cells with its styles, its merges,
 * its column widths and row heights. A cell holds the form's own words, or a
 * caption with this month's figure written after it, exactly as the office
 * types it.
 */
export function templateSheetOf(plan: SheetPlan): XLSX.WorkSheet {
  const { sheet, values, model } = plan.template!;
  const ws: XLSX.WorkSheet = {};
  const widths = templateColWidths(sheet);
  const heights = templateRowHeights(sheet);
  const { spans, covered } = mergeMap(sheet);

  for (let r = 1; r <= sheet.maxRow; r++) {
    for (let c = 1; c <= sheet.maxCol; c++) {
      const ref = `${colLetter(c)}${r}`;
      const cell = sheet.cells[ref];
      if (!cell && !(ref in values)) continue;
      const st = model.styles[cell?.s ?? 0];
      const filled = values[ref];
      const text =
        cell?.kind === 'data'
          ? `${cell.p ?? ''}${filled ?? ''}`
          : (cell?.v ?? (filled != null ? String(filled) : ''));
      // A cell the office left to a formula keeps the formula, so the
      // exported file adds up the way the office's own file does.
      ws[ref] = cell?.f
        ? { t: 'n', f: cell.f, s: excelStyle(st) }
        : { t: 's', v: text, s: excelStyle(st) };
    }
  }

  ws['!ref'] = `A1:${colLetter(Math.max(1, sheet.maxCol))}${Math.max(1, sheet.maxRow)}`;
  ws['!merges'] = [...spans.entries()].map(([ref, span]) => {
    const r = Number(ref.replace(/[^0-9]/g, ''));
    const c = ref
      .replace(/[0-9]/g, '')
      .split('')
      .reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
    return { s: { r: r - 1, c: c - 1 }, e: { r: r - 1 + span.rows - 1, c: c - 1 + span.cols - 1 } };
  });
  // The office's own column widths, in Excel's units. Going through pixels
  // and back inflates them — 45.71 came out as 54.16.
  const wide: { wch: number }[] = [];
  for (let c = 1; c <= sheet.maxCol; c++) {
    const col = sheet.cols.find((x) => c >= x.min && c <= x.max);
    wide.push({ wch: col?.width ?? 8.43 });
  }
  ws['!cols'] = wide;
  // Row heights are in points in the workbook, which is what Excel wants back.
  ws['!rows'] = Array.from({ length: sheet.maxRow }, (_, i) => ({ hpt: sheet.rows[String(i + 1)] ?? sheet.defaultRowHeight ?? 15 }));
  void widths;
  void heights;
  const m = plan.print.margins;
  ws['!margins'] = { left: m.left, right: m.right, top: m.top, bottom: m.bottom, header: 0, footer: 0 };
  void covered;
  return ws;
}

/** One of the workbook's own styles, as xlsx-js-style writes it. */
function excelStyle(st: TemplateModel['styles'][number] | undefined) {
  const border: Record<string, unknown> = {};
  for (const [edge, style] of Object.entries(st?.border ?? {})) {
    if (style) border[edge] = { style: style === 'medium' || style === 'thick' ? 'medium' : 'thin', color: { rgb: '000000' } };
  }
  return {
    font: {
      name: st?.font ?? 'Calibri',
      sz: st?.size ?? 11,
      bold: !!st?.bold,
      italic: !!st?.italic,
      underline: !!st?.underline,
      ...(st?.color ? { color: { rgb: st.color.slice(-6) } } : {}),
    },
    alignment: {
      ...(st?.h ? { horizontal: st.h } : {}),
      ...(st?.v ? { vertical: st.v } : {}),
      wrapText: !!st?.wrap,
    },
    ...(Object.keys(border).length ? { border } : {}),
    ...(st?.fill && !/^FFFFFFFF$/i.test(st.fill) ? { fill: { fgColor: { rgb: st.fill.slice(-6) }, patternType: 'solid' } } : {}),
  };
}

/**
 * The workbook: one sheet per statement, plus the defined names that make
 * Excel repeat each sheet's header rows at the top of every printed page
 * (`_xlnm.Print_Titles`) and print only the statement (`_xlnm.Print_Area`).
 */
export function workbookOf(plans: SheetPlan[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const names: { Name: string; Ref: string; Sheet: number }[] = [];
  plans.forEach((plan, i) => {
    const ws = plan.template ? templateSheetOf(plan) : sheetOf(plan);
    XLSX.utils.book_append_sheet(wb, ws, plan.name);
    const quoted = `'${plan.name.replace(/'/g, "''")}'`;
    if (plan.headerRows > 0) {
      names.push({ Name: '_xlnm.Print_Titles', Ref: `${quoted}!$1:$${plan.headerRows}`, Sheet: i });
    }
    const ref = ws['!ref'];
    if (ref) names.push({ Name: '_xlnm.Print_Area', Ref: `${quoted}!${ref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`, Sheet: i });
  });
  if (names.length) wb.Workbook = { ...(wb.Workbook ?? {}), Names: names };
  return wb;
}

// ── Print setup, patched into the written file ──────────────────────────────

/**
 * The office's own print settings for the sheet: A4, its orientation, and
 * either its scale (CRS Police 145%, RBI 120%) or fit-to-one-page, exactly as
 * `CRS 19 AUG'26.xlsx` has them.
 */
const xmlSheetPr = (p: SheetPrint) => `<sheetPr><pageSetUpPr${p.fitToPage ? ' fitToPage="1"' : ''}/></sheetPr>`;
const xmlPageSetup = (p: SheetPrint) =>
  `<pageSetup paperSize="9" orientation="${p.orientation}" ` +
  (p.fitToPage ? 'fitToWidth="1" fitToHeight="0" ' : `scale="${p.scale}" `) +
  'horizontalDpi="600" verticalDpi="600"/>';
const xmlPrintOptions = (p: SheetPrint) => (p.centred ? '<printOptions horizontalCentered="1"/>' : '');

/** `<sheetViews>` with the header rows frozen, so they stay put while scrolling. */
const xmlSheetViews = (headerRows: number) =>
  headerRows > 0
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRows}" topLeftCell="A${headerRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRows + 1}" sqref="A${headerRows + 1}"/></sheetView></sheetViews>`
    : '';

/**
 * Give each written sheet its page setup and frozen header.
 *
 * `xlsx-js-style` has no writer for either, so the file it produced is
 * unzipped, the sheet XML edited and the file zipped again. Order matters to
 * Excel: `sheetPr` belongs at the top of the sheet and `pageSetup` at the
 * bottom, after the cells — put anywhere else, Excel calls the file corrupt.
 */
export function applyPrintSetup(xlsx: Uint8Array, plans: SheetPlan[]): Uint8Array {
  const files = unzipSync(xlsx);
  plans.forEach((plan, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const raw = files[path];
    if (!raw) return;
    let xml = strFromU8(raw);
    if (!/<sheetPr\b/.test(xml)) xml = xml.replace(/(<worksheet\b[^>]*>)/, `$1${xmlSheetPr(plan.print)}`);

    // The office's own column widths, written verbatim. Handing the writer
    // `wch` gets them back with its own padding added (45.71 → 46.54), and
    // these are the widths the statement is laid out to.
    if (plan.template) {
      const cols = plan.template.sheet.cols
        .map((c) => `<col min="${c.min}" max="${c.max}" width="${c.width}" customWidth="1"/>`)
        .join('');
      if (cols) {
        xml = /<cols>[\s\S]*?<\/cols>/.test(xml)
          ? xml.replace(/<cols>[\s\S]*?<\/cols>/, `<cols>${cols}</cols>`)
          : xml.replace(/(<sheetData)/, `<cols>${cols}</cols>$1`);
      }
    }
    const views = xmlSheetViews(plan.headerRows);
    if (views) {
      // The writer always emits a bare `<sheetViews><sheetView .../></sheetViews>`,
      // so this REPLACES it — adding a second one makes Excel call the file
      // corrupt, and skipping when one exists is how the freeze went missing.
      xml = /<sheetViews\b[\s\S]*?<\/sheetViews>|<sheetViews\b[^>]*\/>/.test(xml)
        ? xml.replace(/<sheetViews\b[\s\S]*?<\/sheetViews>|<sheetViews\b[^>]*\/>/, views)
        : /<dimension\b[^>]*\/>/.test(xml)
          ? xml.replace(/(<dimension\b[^>]*\/>)/, `$1${views}`)
          : xml.replace(/(<worksheet\b[^>]*>(?:<sheetPr>[\s\S]*?<\/sheetPr>)?)/, `$1${views}`);
    }
    if (!/<pageSetup\b/.test(xml)) {
      // Excel's order at the foot of a sheet: printOptions, pageMargins,
      // pageSetup. The margins are the office's own, in inches.
      const m = plan.print.margins;
      xml = xml.replace(
        /<\/worksheet>\s*$/,
        `${xmlPrintOptions(plan.print)}<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="0" footer="0"/>${xmlPageSetup(plan.print)}</worksheet>`,
      );
    }
    files[path] = strToU8(xml);
  });
  return zipSync(files, { level: 6 });
}

/** The finished .xlsx: every selected statement, each on its own sheet. */
export function buildStatementsXlsx(sections: ExportSection[]): Uint8Array {
  const plans = planWorkbook(sections);
  const raw = XLSX.write(workbookOf(plans), { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return applyPrintSetup(new Uint8Array(raw), plans);
}
