/**
 * The office's sheet, drawn as the page Excel would print.
 *
 * The master workbook (`CRS 19 AUG'26.xlsx`) is the statement format, so a
 * statement is that sheet's grid with this month's figures in it — not a
 * layout of our own that happens to carry the same numbers. This renders the
 * extracted model (`src/generated/statement-template.json`, from
 * tools/extract-template.mjs) to HTML: the workbook's own column widths, row
 * heights, merges, fonts, borders, alignment and number formats, on its own
 * paper, at its own scale.
 *
 * It is the SAME page for screen and print. The preview is not a web table
 * that resembles the statement; it is the printed sheet, shown.
 *
 * Nothing here decides what a figure is. Values come in as a map of cell
 * reference to value (`Values`), so the layout and the arithmetic stay apart:
 * the workbook owns where a figure sits, the statement engine owns what it is.
 */

export type TemplateStyle = {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color?: string;
  fill?: string;
  border: { left?: string; right?: string; top?: string; bottom?: string };
  h?: string;
  v?: string;
  wrap: boolean;
  rotate?: number;
  fmt: string;
};

export type TemplateCell = { s: number; kind: 'static' | 'data'; v?: string; t?: string };

export type TemplateSheet = {
  name: string;
  print: {
    paper: number;
    orientation: 'portrait' | 'landscape';
    scale: number;
    fitToPage: boolean;
    fitToWidth: number;
    fitToHeight: number;
    margins: { left: number; right: number; top: number; bottom: number };
    centredH: boolean;
    centredV: boolean;
  };
  cols: { min: number; max: number; width: number }[];
  merges: string[];
  rows: Record<string, number>;
  defaultRowHeight: number;
  cells: Record<string, TemplateCell>;
  maxRow: number;
  maxCol: number;
};

export type TemplateModel = { source: string; extractedAt: string; styles: TemplateStyle[]; sheets: TemplateSheet[] };

/** Cell reference → what the statement says there. */
export type Values = Record<string, string | number | null | undefined>;

// ── Geometry ────────────────────────────────────────────────────────────────

/**
 * Excel's column width is measured in characters of the standard font; a
 * column of width `w` is `w * 7 + 5` pixels wide at 96 dpi (7 px per digit of
 * Calibri 11, plus the 5 px of cell padding). Row heights are in points.
 */
export const colPx = (width: number): number => Math.round(width * 7 + 5);
export const ptPx = (pt: number): number => Math.round((pt * 96) / 72);

const A4 = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } };
const MM_PER_IN = 25.4;
const MM_PER_PX = MM_PER_IN / 96;

export const colLetter = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
export const colNumber = (s: string): number => [...s].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
const refOf = (r: number, c: number) => `${colLetter(c)}${r}`;

/** Every column's width in pixels, 1-based. */
export function columnWidths(sheet: TemplateSheet): number[] {
  const out = new Array(sheet.maxCol + 1).fill(colPx(8.43));
  for (const c of sheet.cols) {
    for (let i = c.min; i <= Math.min(c.max, sheet.maxCol); i++) out[i] = colPx(c.width);
  }
  return out;
}

/** Row heights in pixels, 1-based, the sheet's default where it says nothing. */
export function rowHeights(sheet: TemplateSheet): number[] {
  const out = new Array(sheet.maxRow + 1).fill(ptPx(sheet.defaultRowHeight || 15));
  for (const [r, h] of Object.entries(sheet.rows)) {
    const i = Number(r);
    if (i <= sheet.maxRow) out[i] = ptPx(h);
  }
  return out;
}

type Span = { rows: number; cols: number };

/** Merges as spans on their top-left cell, plus the cells they swallow. */
export function mergeMap(sheet: TemplateSheet): { spans: Map<string, Span>; covered: Set<string> } {
  const spans = new Map<string, Span>();
  const covered = new Set<string>();
  for (const ref of sheet.merges) {
    const [a, b] = ref.split(':');
    if (!a || !b) continue;
    const r1 = Number(a.replace(/\D+/g, ''));
    const c1 = colNumber(a.replace(/\d+/g, ''));
    const r2 = Number(b.replace(/\D+/g, ''));
    const c2 = colNumber(b.replace(/\d+/g, ''));
    spans.set(a, { rows: r2 - r1 + 1, cols: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(refOf(r, c));
  }
  return { spans, covered };
}

// ── The sheet's own look ────────────────────────────────────────────────────

const BORDER_PX: Record<string, string> = {
  thin: '1px solid #000',
  medium: '2px solid #000',
  thick: '3px solid #000',
  double: '3px double #000',
  hair: '1px solid #666',
  dotted: '1px dotted #000',
  dashed: '1px dashed #000',
};
const edge = (style?: string) => (style ? (BORDER_PX[style] ?? '1px solid #000') : '0');

const ALIGN: Record<string, string> = { left: 'left', right: 'right', center: 'center', centerContinuous: 'center', justify: 'justify', general: '' };
const VALIGN: Record<string, string> = { top: 'top', center: 'middle', bottom: 'bottom' };

/** One cell's CSS — the workbook's own formatting, nothing added. */
export function cellCss(st: TemplateStyle, numeric: boolean): string {
  const parts = [
    `font-family:'${st.font}',Calibri,Arial,sans-serif`,
    `font-size:${st.size}pt`,
    st.bold ? 'font-weight:700' : 'font-weight:400',
    st.italic ? 'font-style:italic' : '',
    st.underline ? 'text-decoration:underline' : '',
    st.color && !/^FF0{6}$|^0{8}$/i.test(st.color) ? `color:#${st.color.slice(-6)}` : 'color:#000',
    st.fill && !/^FFFFFFFF$/i.test(st.fill) ? `background:#${st.fill.slice(-6)}` : '',
    `border-left:${edge(st.border.left)}`,
    `border-right:${edge(st.border.right)}`,
    `border-top:${edge(st.border.top)}`,
    `border-bottom:${edge(st.border.bottom)}`,
    // Excel's default: text left, numbers right, unless the cell says otherwise.
    `text-align:${ALIGN[st.h ?? ''] || (numeric ? 'right' : 'left')}`,
    `vertical-align:${VALIGN[st.v ?? ''] ?? 'bottom'}`,
    st.wrap ? 'white-space:pre-wrap;word-break:break-word' : 'white-space:nowrap;overflow:hidden',
    st.rotate ? `writing-mode:vertical-rl;transform:rotate(${st.rotate === 90 ? 180 : 0}deg)` : '',
    'padding:0 2px',
  ];
  return parts.filter(Boolean).join(';');
}

// ── Number formats ──────────────────────────────────────────────────────────

/**
 * A value as the sheet shows it. Only the formats this workbook uses are
 * honoured — fixed decimals, thousands separators and its two date forms —
 * because a format it does not use cannot appear on a statement.
 */
export function formatValue(value: string | number | null | undefined, fmt: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  const f = (fmt || 'General').replace(/;.*$/, '').replace(/\\/g, '').replace(/"[^"]*"/g, '');
  if (/^general$/i.test(f)) return String(value);
  const dec = (f.match(/\.(0+)/) ?? [, ''])[1].length;
  const grouped = /#,##/.test(f);
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const fixed = n.toFixed(dec);
  if (!grouped) return fixed;
  const [i, d] = fixed.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? `.${d}` : '');
}

// ── The page ────────────────────────────────────────────────────────────────

/**
 * The scale Excel prints this sheet at: its own percentage, or — when the
 * sheet is set to fit one page — whatever it takes to bring the grid inside
 * the printable width.
 */
export function printScale(sheet: TemplateSheet): number {
  const widths = columnWidths(sheet);
  const contentPx = widths.slice(1).reduce((t, w) => t + w, 0);
  const paper = A4[sheet.print.orientation];
  const printableMm = paper.w - (sheet.print.margins.left + sheet.print.margins.right) * MM_PER_IN;
  const printablePx = printableMm / MM_PER_PX;
  if (!sheet.print.fitToPage) return sheet.print.scale / 100;
  return contentPx > printablePx ? printablePx / contentPx : 1;
}

/** The page rules for this sheet: its paper, its margins, its centring. */
export function pageCssFor(sheet: TemplateSheet, pageId: string): string {
  const m = sheet.print.margins;
  const mm = (inches: number) => Math.round(inches * MM_PER_IN * 100) / 100;
  return [
    `@page ${pageId}{size:A4 ${sheet.print.orientation};margin:${mm(m.top)}mm ${mm(m.right)}mm ${mm(m.bottom)}mm ${mm(m.left)}mm}`,
    `.tpl-sheet[data-page="${pageId}"]{page:${pageId}}`,
  ].join('\n');
}

/**
 * One sheet, with these values in it, as the page it prints on.
 *
 * `pageId` names the CSS page so several statements can sit in one document,
 * each on its own paper.
 */
export function renderSheet(model: TemplateModel, sheet: TemplateSheet, values: Values, pageId = 'tpl'): string {
  const widths = columnWidths(sheet);
  const heights = rowHeights(sheet);
  const { spans, covered } = mergeMap(sheet);
  const scale = printScale(sheet);

  const cols: string[] = [];
  for (let c = 1; c <= sheet.maxCol; c++) cols.push(`<col style="width:${widths[c]}px"/>`);

  const rows: string[] = [];
  for (let r = 1; r <= sheet.maxRow; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= sheet.maxCol; c++) {
      const ref = refOf(r, c);
      if (covered.has(ref)) continue;
      const cell = sheet.cells[ref];
      const st = model.styles[cell?.s ?? 0] ?? model.styles[0];
      const span = spans.get(ref);
      // A static cell keeps the form's own words; a data cell takes the
      // statement's figure, and shows nothing when there is none.
      const raw = cell?.kind === 'data' ? values[ref] : (cell?.v ?? (ref in values ? values[ref] : ''));
      const numeric = typeof raw === 'number';
      const shown = formatValue(raw, st?.fmt ?? 'General');
      cells.push(
        `<td${span ? `${span.rows > 1 ? ` rowspan="${span.rows}"` : ''}${span.cols > 1 ? ` colspan="${span.cols}"` : ''}` : ''}` +
          ` style="${cellCss(st ?? ({} as TemplateStyle), numeric)}">${escapeHtml(shown)}</td>`,
      );
    }
    rows.push(`<tr style="height:${heights[r]}px">${cells.join('')}</tr>`);
  }

  const width = widths.slice(1).reduce((t, w) => t + w, 0);
  return (
    `<div class="tpl-sheet" data-page="${pageId}" data-sheet="${escapeHtml(sheet.name)}">` +
    `<div class="tpl-scale" style="transform:scale(${scale.toFixed(4)});transform-origin:top ${sheet.print.centredH ? 'center' : 'left'};width:${width}px${sheet.print.centredH ? ';margin:0 auto' : ''}">` +
    `<table class="tpl-grid" style="width:${width}px;table-layout:fixed;border-collapse:collapse">` +
    `<colgroup>${cols.join('')}</colgroup><tbody>${rows.join('')}</tbody></table>` +
    '</div></div>'
  );
}

const escapeHtml = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The stylesheet every template page needs, once per document. */
export const TEMPLATE_CSS = [
  '.tpl-grid td{box-sizing:border-box}',
  '.tpl-sheet{break-after:page;page-break-after:always}',
  '.tpl-sheet:last-child{break-after:auto;page-break-after:auto}',
  '@media screen{body{background:#E2E8F0;margin:0}',
  '.tpl-sheet{background:#fff;margin:12px auto;padding:6mm;box-shadow:0 2px 10px rgba(0,0,0,.15);box-sizing:border-box;overflow:hidden}',
  '.tpl-sheet[data-orient="portrait"]{width:210mm;min-height:297mm}',
  '.tpl-sheet[data-orient="landscape"]{width:297mm;min-height:210mm}}',
  '@media print{body{margin:0;background:#fff}.tpl-sheet{margin:0;padding:0;box-shadow:none;width:auto;min-height:0}}',
].join('\n');
