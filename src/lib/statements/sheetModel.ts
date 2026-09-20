/**
 * A rendered statement, read back as a grid of cells.
 *
 * The Excel export used to hand Excel the statements' HTML with a .xls name.
 * Excel took the lot as ONE sheet, and the sections that are laid out with
 * flexbox rather than a table (CRS Page 1 is entirely flex) collapsed into
 * overlapping text. So the HTML is parsed here into rows and cells first, and
 * the workbook is built from that — one worksheet per statement.
 *
 * Parsed from the markup string rather than through DOMParser so the same code
 * runs in the browser and under Node in `npm run verify:statement-export`,
 * where it is checked against all 306 golden statements. The input is not the
 * web at large: it is our own builders' output, whose shape the goldens pin.
 *
 * NOTHING here changes a figure. Cell text is the statement's own text; only
 * its place in the grid is worked out.
 */

export type CellAlign = 'left' | 'center' | 'right';

export type Cell = {
  /** The text as the statement shows it. */
  text: string;
  /** A heading cell (<th>, or a section title) — bold, and repeated on later printed pages. */
  header: boolean;
  bold: boolean;
  align: CellAlign;
  colspan: number;
  rowspan: number;
  /** Set when the text is a plain number, so Excel stores a number, not a string. */
  num?: number;
  /** How many decimals the statement printed, so 4750.000 does not become 4750. */
  decimals?: number;
};

export type Grid = {
  rows: Cell[][];
  cols: number;
  /** Rows at the top that are headings — frozen on screen, repeated when printed. */
  headerRows: number;
};

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', times: '×', deg: '°',
};

/** Tags to text: entities decoded, <br> as a line break, runs of space collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
};
const span = (tag: string, name: string): number => Math.max(1, Math.floor(Number(attr(tag, name))) || 1);

/**
 * A number the statement printed, with the decimals it printed — `4,750.000`
 * is 4750 shown to three places, and `₹1,234.50` is 1234.5 to two. Anything
 * else (a date, a name, `12 & 3`) stays text, so nothing is reinterpreted.
 */
export function numberOf(text: string): { num: number; decimals: number } | null {
  const t = text.trim().replace(/^[₹\s]+/, '');
  if (!/^-?[\d,]+(\.\d+)?$/.test(t)) return null;
  const plain = t.replace(/,/g, '');
  const num = Number(plain);
  if (!Number.isFinite(num)) return null;
  const dot = plain.indexOf('.');
  return { num, decimals: dot < 0 ? 0 : plain.length - dot - 1 };
}

/** Alignment as the statement asks for it: its own style first, then its class. */
function alignOf(tag: string, cls: string, isHeader: boolean): CellAlign {
  const style = attr(tag, 'style');
  const inStyle = /text-align\s*:\s*(left|right|center)/i.exec(style);
  if (inStyle) return inStyle[1].toLowerCase() as CellAlign;
  if (/\b(right|r|amt|num)\b/.test(cls) || /\bright\b/.test(cls)) return 'right';
  if (/\b(center|c|ctr)\b/.test(cls)) return 'center';
  if (/\bl\b/.test(cls)) return 'left';
  return isHeader ? 'center' : 'left';
}

const cell = (tag: string, inner: string, isHeader: boolean): Cell => {
  const cls = attr(tag, 'class');
  const text = textOf(inner);
  const n = numberOf(text);
  const style = attr(tag, 'style');
  return {
    text,
    header: isHeader,
    bold: isHeader || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || /\bbold\b/.test(cls) || /<(b|strong)\b/i.test(inner),
    align: alignOf(tag, cls, isHeader),
    colspan: span(tag, 'colspan'),
    rowspan: span(tag, 'rowspan'),
    ...(n ? { num: n.num, decimals: n.decimals } : {}),
  };
};

/** The statement's <table>s, in order, as grids of raw cells. */
function tableRows(table: string): { rows: Cell[][]; headerRows: number } {
  const rows: Cell[][] = [];
  let headerRows = 0;
  let inHead = false;
  const parts = table.split(/(<thead\b[^>]*>|<\/thead>|<tr\b[^>]*>)/i);
  let current: string | null = null;
  const flush = (chunk: string) => {
    if (current === null) return;
    const cells: Cell[] = [];
    const re = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) cells.push(cell(`<${m[1]}${m[2]}>`, m[3], m[1].toLowerCase() === 'th'));
    if (cells.length) {
      rows.push(cells);
      if (inHead || cells.every((c) => c.header)) headerRows = Math.max(headerRows, rows.length);
    }
    current = null;
  };
  for (const part of parts) {
    if (/^<thead/i.test(part)) {
      inHead = true;
      continue;
    }
    if (/^<\/thead>/i.test(part)) {
      inHead = false;
      continue;
    }
    if (/^<tr/i.test(part)) {
      current = part;
      continue;
    }
    flush(part);
  }
  // Only a run of heading rows AT THE TOP is a header — a bold total row in
  // the middle is not something to repeat on page two.
  let top = 0;
  while (top < rows.length && rows[top].every((c) => c.header)) top++;
  return { rows, headerRows: Math.min(headerRows, top) };
}

/**
 * The `<div>` blocks directly inside this markup, nesting counted properly —
 * a div holding divs must come back whole, not cut at the first `</div>`.
 */
function topLevelDivs(html: string): { open: string; inner: string }[] {
  const out: { open: string; inner: string }[] = [];
  const re = /<(\/?)div\b([^>]*)>/gi;
  let depth = 0;
  let start = -1;
  let open = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!m[1]) {
      if (depth === 0) {
        open = m[0];
        start = m.index + m[0].length;
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) out.push({ open, inner: html.slice(start, m.index) });
    }
  }
  return out;
}

/**
 * The rows a flex-laid-out statement makes (CRS Page 1 is entirely flex): a
 * div holding several divs is a row of cells, one per child; a div holding
 * only text is a line of its own, spanning the sheet. Anything deeper is
 * walked into, so a wrapper never becomes one squashed cell.
 */
function divRows(html: string): Cell[][] {
  const rows: Cell[][] = [];
  for (const block of topLevelDivs(html)) {
    const children = topLevelDivs(block.inner);
    const hasText = textOf(block.inner).trim() !== '';
    if (!hasText) continue;
    if (children.length > 1) {
      // A row of cells, unless the children are themselves rows (a wrapper),
      // in which case walk in and keep their own shape.
      const grandchildren = children.filter((c) => topLevelDivs(c.inner).length > 1);
      if (grandchildren.length) {
        rows.push(...divRows(block.inner));
        continue;
      }
      rows.push(children.map((c) => cell(c.open, c.inner, false)));
      continue;
    }
    if (children.length === 1 && topLevelDivs(children[0].inner).length > 1) {
      rows.push(...divRows(block.inner));
      continue;
    }
    rows.push([cell(block.open, block.inner, false)]);
  }
  return rows;
}

/** Widen every row to the same number of columns, counting colspans. */
function widthOf(rows: Cell[][]): number {
  let cols = 0;
  for (const row of rows) {
    const n = row.reduce((t, c) => t + c.colspan, 0);
    if (n > cols) cols = n;
  }
  return cols;
}

/**
 * One rendered statement as a grid.
 *
 * Its tables are taken in order; a statement with none (CRS Page 1) is read
 * from its layout divs instead, and a statement with both keeps its headings
 * above its tables.
 */
export function parseStatement(html: string): Grid {
  const body = html.replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const tables = body.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
  const rows: Cell[][] = [];
  let headerRows = 0;

  if (!tables.length) {
    rows.push(...divRows(body));
    return { rows, cols: widthOf(rows), headerRows: 0 };
  }

  // Whatever stands before the first table — the title lines and the
  // "NAME OF THE B.C" block — is kept above it, one line per row.
  const lead = body.slice(0, body.indexOf(tables[0] ?? ''));
  for (const line of textOf(lead).split('\n')) {
    if (line.trim()) rows.push([{ text: line.trim(), header: false, bold: true, align: 'center', colspan: 1, rowspan: 1 }]);
  }
  if (rows.length) {
    headerRows = rows.length;
    rows.push([{ text: '', header: false, bold: false, align: 'left', colspan: 1, rowspan: 1 }]);
  }

  let rest = body;
  tables.forEach((table, i) => {
    if (i > 0) {
      // Text between two tables (a sub-heading) keeps its place.
      const gap = rest.slice(0, rest.indexOf(table));
      for (const line of textOf(gap).split('\n')) {
        if (line.trim()) rows.push([{ text: line.trim(), header: false, bold: true, align: 'left', colspan: 1, rowspan: 1 }]);
      }
      rows.push([{ text: '', header: false, bold: false, align: 'left', colspan: 1, rowspan: 1 }]);
    }
    const parsed = tableRows(table);
    if (i === 0 && parsed.headerRows) headerRows = rows.length + parsed.headerRows;
    rows.push(...parsed.rows);
    rest = rest.slice(rest.indexOf(table) + table.length);
  });

  // The signature block after the last table.
  for (const line of textOf(rest).split('\n')) {
    if (line.trim()) rows.push([{ text: line.trim(), header: false, bold: true, align: 'left', colspan: 1, rowspan: 1 }]);
  }

  return { rows, cols: widthOf(rows), headerRows };
}
