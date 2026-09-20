/**
 * Read the office's master workbook into a layout model.
 *
 *   node tools/extract-template.mjs "CRS 19 AUG'26.xlsx" [outFile]
 *
 * The workbook — `CRS 19 AUG'26.xlsx` — is the statement format itself: its
 * column widths, row heights, merges, cell styles and per-sheet print setup
 * are what a statement must look like. This reads all of that into
 * `src/generated/statement-template.json`, which the preview renderer and the
 * Excel export both build from.
 *
 * WHAT IS KEPT AND WHAT IS NOT. Layout and styling are kept in full. The
 * FIGURES ARE NOT: every cell is marked `static` (a heading, a caption, a
 * ruled label — part of the form) or `data` (a figure, a date, a shop or
 * person's name — one month of one shop's business), and a data cell's value
 * is dropped. What is committed is a blank form, so no shop's figures and no
 * member of staff's name lives in the repository.
 *
 * A cell counts as data when it is numeric, or when its text carries the shop
 * number, the month, or anything the form does not print for every shop and
 * every month. Anything else is the form, and is kept verbatim.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
const out = process.argv[3] ?? join(root, 'src', 'generated', 'statement-template.json');
if (!src) {
  console.error('usage: node tools/extract-template.mjs "<workbook.xlsx>" [out.json]');
  process.exit(2);
}

const zip = unzipSync(new Uint8Array(readFileSync(src)));
const text = (path) => (zip[path] ? strFromU8(zip[path]) : '');
const attr = (s, a) => {
  const m = s.match(new RegExp(`\\b${a}="([^"]*)"`));
  return m ? m[1] : undefined;
};
const num = (v, dflt) => (v === undefined || v === '' ? dflt : Number(v));

// ── shared strings ──────────────────────────────────────────────────────────
const sharedXml = text('xl/sharedStrings.xml');
const shared = [];
for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
  // <t> runs, concatenated: rich text keeps its pieces in order.
  shared.push(
    (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
      .map((t) => t.replace(/<[^>]*>/g, ''))
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );
}

// ── styles ──────────────────────────────────────────────────────────────────
const stylesXml = text('xl/styles.xml');
const block = (name) => {
  const m = stylesXml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
};
/**
 * The `<tag>` records inside a styles block, in order.
 *
 * The self-closing form MUST come first in the alternation. With
 * `(?:/>|>…</tag>)`, a `<xf .../>` is matched by the second branch instead,
 * which runs on to the NEXT `</xf>` and eats every self-closing record in
 * between: 432 cell styles came back as 245, every index after the first one
 * shifted, and every cell was drawn in another cell's font.
 */
const items = (body, tag) => body.match(new RegExp(`<${tag}\\b[^>]*/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g')) ?? [];

const fonts = items(block('fonts'), 'font').map((f) => ({
  name: attr(f, 'val') && /<name /.test(f) ? (f.match(/<name val="([^"]*)"/) ?? [])[1] : (f.match(/<name val="([^"]*)"/) ?? [])[1] ?? 'Calibri',
  size: num((f.match(/<sz val="([^"]*)"/) ?? [])[1], 11),
  bold: /<b\s*\/>|<b val="(1|true)"/.test(f),
  italic: /<i\s*\/>|<i val="(1|true)"/.test(f),
  underline: /<u\s*\/>|<u val="(?!none)/.test(f),
  color: (f.match(/<color rgb="([^"]*)"/) ?? [])[1],
}));

const EDGES = ['left', 'right', 'top', 'bottom'];
const borders = items(block('borders'), 'border').map((b) => {
  const edge = {};
  for (const e of EDGES) {
    const m = b.match(new RegExp(`<${e}[^>]*style="([^"]*)"`));
    if (m) edge[e] = m[1];
  }
  return edge;
});

const fills = items(block('fills'), 'fill').map((f) => (f.match(/<fgColor rgb="([^"]*)"/) ?? [])[1]);

const numFmts = {};
for (const nf of stylesXml.match(/<numFmt\b[^>]*\/>/g) ?? []) numFmts[attr(nf, 'numFmtId')] = attr(nf, 'formatCode');

const cellXfs = items(block('cellXfs'), 'xf').map((xf) => {
  const al = (xf.match(/<alignment\b[^>]*\/>/) ?? [])[0] ?? '';
  return {
    font: num(attr(xf, 'fontId'), 0),
    border: num(attr(xf, 'borderId'), 0),
    fill: num(attr(xf, 'fillId'), 0),
    numFmtId: attr(xf, 'numFmtId') ?? '0',
    h: attr(al, 'horizontal'),
    v: attr(al, 'vertical'),
    wrap: attr(al, 'wrapText') === '1',
    rotate: num(attr(al, 'textRotation'), 0) || undefined,
  };
});

/** One style record, flattened — what the renderer and the writer both need. */
const styleOf = (s) => {
  const xf = cellXfs[s] ?? cellXfs[0] ?? {};
  const font = fonts[xf.font] ?? {};
  return {
    font: font.name ?? 'Calibri',
    size: font.size ?? 11,
    bold: !!font.bold,
    italic: !!font.italic,
    underline: !!font.underline,
    color: font.color,
    fill: fills[xf.fill],
    border: borders[xf.border] ?? {},
    h: xf.h,
    v: xf.v,
    wrap: !!xf.wrap,
    rotate: xf.rotate,
    fmt: numFmts[xf.numFmtId] ?? builtinFmt(xf.numFmtId),
  };
};

/** The built-in number formats these sheets actually use. */
function builtinFmt(id) {
  return { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'dd-mm-yyyy', 164: 'General' }[Number(id)] ?? 'General';
}

// ── sheets ──────────────────────────────────────────────────────────────────
const relTargets = {};
for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  relTargets[m[1]] = m[2].replace(/^\/?xl\//, '');
}
const wbXml = text('xl/workbook.xml');

const colLetter = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const colNumber = (s) => [...s].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);

/**
 * Is this cell the FORM, or this month's business?
 *
 * Numbers and dates are always business. Text is business when it names the
 * shop, the month or a person — everything else (headings, commodity names,
 * "TOTAL", the signature captions) is printed for every shop every month and
 * is part of the form.
 */
// A month or a year names one month of one shop's business, however it is
// punctuated — AUG'26, AUG"2026, "PONGAL STATEMENT 2026".
const MONTHS = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*['’"\s]*\d{2,4}|\b(19|20)\d{2}\b/i;
function classify(value, type) {
  if (value === undefined || value === '') return 'static';
  if (type !== 's') return 'data';
  const t = String(value).trim();
  if (MONTHS.test(t)) return 'data';
  if (/\bCRS\b[\s.:-]*\d/i.test(t)) return 'data';
  // A caption with something written after it is a caption PLUS an entry:
  // "NAME OF THE B.C: Rahamathullakhan", "RICE CARD : 698". The entry is a
  // person or a figure, so the whole cell is data and the statement writes
  // the caption back with it. A caption with nothing after it — "NOTE:",
  // "LOF SUGAR CARD :" — is just the form.
  if (/:\s*\S/.test(t)) return 'data';
  // A figure, a count, a serial number — but "50KG SS", "1ST WEEK" and
  // "50 KG SS BAGS" are the form's own words, which happen to start with a
  // digit. Letters mean it is a label.
  if (/^\d/.test(t) && !/[A-Za-z]{2,}/.test(t)) return 'data';
  // A phone number, or anything else that is mostly digits.
  if ((t.match(/\d/g) ?? []).length >= 6) return 'data';
  return 'static';
}

const sheets = [];
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"[^>]*\/>/g)) {
  const [, name, rid] = m;
  const xml = text('xl/' + relTargets[rid]);
  if (!xml) continue;

  const cols = [];
  for (const c of xml.match(/<col\b[^>]*\/>/g) ?? []) {
    cols.push({ min: num(attr(c, 'min'), 1), max: num(attr(c, 'max'), 1), width: num(attr(c, 'width'), 8.43) });
  }

  const merges = (xml.match(/<mergeCell\b[^>]*\/>/g) ?? []).map((x) => attr(x, 'ref'));

  const ps = (xml.match(/<pageSetup\b[^>]*\/>/) ?? [''])[0];
  const pm = (xml.match(/<pageMargins\b[^>]*\/>/) ?? [''])[0];
  const po = (xml.match(/<printOptions\b[^>]*\/>/) ?? [''])[0];
  const print = {
    paper: num(attr(ps, 'paperSize'), 9),
    orientation: attr(ps, 'orientation') ?? 'portrait',
    scale: num(attr(ps, 'scale'), 100),
    fitToPage: /fitToPage="1"/.test(xml),
    fitToWidth: num(attr(ps, 'fitToWidth'), 1),
    fitToHeight: num(attr(ps, 'fitToHeight'), 1),
    margins: {
      left: num(attr(pm, 'left'), 0.7),
      right: num(attr(pm, 'right'), 0.7),
      top: num(attr(pm, 'top'), 0.75),
      bottom: num(attr(pm, 'bottom'), 0.75),
    },
    centredH: /horizontalCentered="1"/.test(po),
    centredV: /verticalCentered="1"/.test(po),
  };

  const defaultRowHeight = num(attr((xml.match(/<sheetFormatPr\b[^>]*\/>/) ?? [''])[0], 'defaultRowHeight'), 15);
  const rows = {};
  const cells = {};
  let maxRow = 0;
  let maxCol = 0;

  // Self-closing first, here too — see `items()`. A `<row .../>` or
  // `<c .../>` matched by the container branch runs on to the next closing
  // tag and swallows every empty cell in between, which put F12's "G.TOTAL"
  // into B12 on the police sheet.
  for (const rowXml of xml.match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const r = num(attr(rowXml, 'r'), 0);
    const ht = attr(rowXml, 'ht');
    if (ht !== undefined) rows[r] = Number(ht);
    for (const cXml of rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const ref = attr(cXml, 'r');
      if (!ref) continue;
      const t = attr(cXml, 't');
      const s = num(attr(cXml, 's'), 0);
      const vRaw = (cXml.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
      const isXml = t === 'inlineStr';
      const inline = isXml ? (cXml.match(/<t[^>]*>([\s\S]*?)<\/t>/) ?? [])[1] : undefined;
      const value = t === 's' && vRaw !== undefined ? shared[Number(vRaw)] : (inline ?? vRaw);
      // A formula belongs to the FORM, not to the month: `SUM(I7:I10)` totals
      // the police amounts on every shop's sheet. Keeping it means the
      // exported workbook adds up the way the office's own file does.
      const formula = (cXml.match(/<f[^>]*>([\s\S]*?)<\/f>/) ?? [])[1];
      const kind = formula ? 'data' : classify(value, t === 's' || isXml ? 's' : t);
      const col = colNumber(ref.replace(/\d+/g, ''));
      const row = Number(ref.replace(/\D+/g, ''));
      if (value === undefined && s === 0) continue; // nothing to say about this cell
      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
      cells[ref] = {
        s,
        kind,
        // A data cell's value is NOT kept: the form is committed blank.
        ...(kind === 'static' && value !== undefined ? { v: value } : {}),
        ...(formula ? { f: formula } : {}),
        ...(t && t !== 's' ? { t } : {}),
      };
    }
  }

  // Trim to the sheet the office actually uses.
  //
  // The workbook comes out of Google Sheets, which styles every cell of a
  // 1000-row grid whether or not anything is on it — 6,114 cells on CRS DAILY
  // SALE against the 38 rows the statement occupies. Anything past the last
  // row and column that carries a value, or that a merge reaches, is that
  // padding, and keeping it would make the committed form 3 MB of nothing.
  let lastRow = 0;
  let lastCol = 0;
  for (const [ref, cell] of Object.entries(cells)) {
    if (cell.v === undefined && cell.kind !== 'data') continue;
    lastRow = Math.max(lastRow, Number(ref.replace(/\D+/g, '')));
    lastCol = Math.max(lastCol, colNumber(ref.replace(/\d+/g, '')));
  }
  for (const ref of merges) {
    const end = ref.split(':')[1] ?? ref;
    lastRow = Math.max(lastRow, Number(end.replace(/\D+/g, '')));
    lastCol = Math.max(lastCol, colNumber(end.replace(/\d+/g, '')));
  }
  const kept = {};
  for (const [ref, cell] of Object.entries(cells)) {
    const r = Number(ref.replace(/\D+/g, ''));
    const c = colNumber(ref.replace(/\d+/g, ''));
    if (r <= lastRow && c <= lastCol) kept[ref] = cell;
  }
  const keptRows = {};
  for (const [r, h] of Object.entries(rows)) if (Number(r) <= lastRow) keptRows[r] = h;

  sheets.push({
    name,
    print,
    cols: cols.filter((c) => c.min <= lastCol),
    merges,
    rows: keptRows,
    defaultRowHeight,
    cells: kept,
    maxRow: lastRow,
    maxCol: lastCol,
  });
}

const model = {
  source: src.replace(/\\/g, '/').split('/').pop(),
  extractedAt: new Date().toISOString().slice(0, 10),
  styles: cellXfs.map((_, i) => styleOf(i)),
  sheets,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(model, null, 1));

const dataCells = sheets.reduce((n, s) => n + Object.values(s.cells).filter((c) => c.kind === 'data').length, 0);
const staticCells = sheets.reduce((n, s) => n + Object.values(s.cells).filter((c) => c.kind === 'static').length, 0);
console.log(`${sheets.length} sheets, ${model.styles.length} styles`);
console.log(`  form (kept):      ${staticCells} cells`);
console.log(`  figures (blanked): ${dataCells} cells`);
console.log(`→ ${out}`);
for (const s of sheets) {
  console.log(
    `  ${s.name.padEnd(18)} ${s.print.orientation.padEnd(9)} scale ${String(s.print.scale).padStart(3)} ` +
      `${s.print.fitToPage ? 'fit ' : '    '} merges ${String(s.merges.length).padStart(2)}  ` +
      `${colLetter(s.maxCol)}${s.maxRow}  data ${String(Object.values(s.cells).filter((c) => c.kind === 'data').length).padStart(3)}`,
  );
}
