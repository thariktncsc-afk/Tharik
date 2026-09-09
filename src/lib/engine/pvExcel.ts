'use client';

/**
 * Reading a month's figures back out of an Excel statement, and writing one
 * that can be read back exactly.
 *
 * WHY EXCEL AND NOT PDF. These figures end up on statutory paperwork, so a
 * misread is worse than a refusal. A spreadsheet has discrete cells with
 * headers; a printed PDF has neither, and recovering numbers from one means
 * guessing from text positions. Everything below therefore refuses what it
 * cannot identify rather than doing its best.
 *
 * COLUMNS ARE MATCHED BY HEADER NAME, NEVER BY POSITION. That rule is written
 * in blood in this project: a positional importer once shifted 13 of 22 shops'
 * figures silently, because the 22 monthly workbooks carry 13 different column
 * layouts. Anything here that looks at a column looks at its heading first.
 *
 * The Excel writer is loaded from the same CDN the DSS export uses, so there is
 * one Excel library in the app and it is only fetched when someone actually
 * exports or uploads.
 */
import { DSS_A, DSS_B, CRS29_STOCK, type Commodity } from '@/lib/engine/commodities';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sheet = Record<string, any>;
type XlsxLib = {
  read: (data: ArrayBuffer | Uint8Array, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, Sheet> };
  utils: {
    sheet_to_json: (ws: Sheet, opts: Record<string, unknown>) => unknown[][];
    aoa_to_sheet: (rows: unknown[][]) => Sheet;
    book_new: () => Record<string, unknown>;
    book_append_sheet: (wb: Record<string, unknown>, ws: Sheet, name: string) => void;
  };
  writeFile: (wb: Record<string, unknown>, name: string) => void;
};

declare global {
  interface Window {
    XLSX?: XlsxLib;
  }
}

const CDN = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';

/** Same lazy-load the DSS export uses — one Excel library, fetched on demand. */
export function loadXlsx(): Promise<XlsxLib> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Excel is only available in the browser.'));
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CDN}"]`);
    const done = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('The Excel library loaded but did not register.')));
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', () => reject(new Error('Could not load the Excel library.')));
      return;
    }
    const s = document.createElement('script');
    s.src = CDN;
    s.onload = done;
    s.onerror = () => reject(new Error('Could not load the Excel library. An internet connection is needed the first time you import or export.'));
    document.head.appendChild(s);
  });
}

// ── The sheet this app writes ───────────────────────────────────────────────

/** Exactly the fields a PV consolidates. */
export type PvMonthRow = {
  commId: string;
  name: string;
  unit: string;
  open: number;
  receipt: number;
  total: number;
  sales: number;
  closing: number;
  amount: number;
};

export type PvMonthData = {
  crsId: number;
  crsName: string;
  month: number;
  year: number;
  rows: PvMonthRow[];
};

export const PV_SHEET_NAME = 'TNCSC PV DATA';
/** Bumped only if the column set changes; the reader checks it. */
export const PV_SHEET_VERSION = 1;

const HEADERS = ['Commodity ID', 'Commodity', 'Unit', 'Opening', 'Receipt', 'Total', 'Sales', 'Closing', 'Amount'] as const;

const MNAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A month as a machine-readable sheet.
 *
 * The identifying fields are written as their own labelled rows above the
 * table, so the reader never has to infer the shop or the period from a
 * filename — a file called "May.xlsx" holding April's figures is caught.
 */
export function buildMonthlySheet(xlsx: XlsxLib, data: PvMonthData): Record<string, unknown> {
  const aoa: unknown[][] = [
    ['TNCSC CRS — MONTHLY PV DATA'],
    ['Format Version', PV_SHEET_VERSION],
    ['CRS Number', data.crsId],
    ['CRS Shop', data.crsName],
    ['Month', MNAMES[data.month]],
    ['Month Number', data.month],
    ['Year', data.year],
    [],
    [...HEADERS],
    ...data.rows.map((r) => [r.commId, r.name, r.unit, r.open, r.receipt, r.total, r.sales, r.closing, r.amount]),
  ];
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, PV_SHEET_NAME);
  return wb;
}

export function monthlyFileName(data: PvMonthData): string {
  return `TNCSC_CRS${data.crsId}_${MNAMES[data.month]}_${data.year}_PVDATA.xlsx`;
}

// ── Reading one back ────────────────────────────────────────────────────────

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v: unknown) => norm(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v ?? '').replace(/[₹,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/** Header spellings accepted for each field. Order is irrelevant. */
const FIELD_ALIASES: Record<keyof Omit<PvMonthRow, 'commId' | 'name' | 'unit'>, string[]> = {
  open: ['opening', 'openingbalance', 'ob', 'openingstock'],
  receipt: ['receipt', 'receipts', 'receiptqty'],
  total: ['total', 'totalstock'],
  sales: ['sales', 'issues', 'totalsales', 'issue'],
  closing: ['closing', 'closingbalance', 'cb', 'balance', 'closingstock'],
  amount: ['amount', 'totalamount', 'value', 'saleamount'],
};
const NAME_ALIASES = ['commodity', 'commodityname', 'item', 'particulars', 'name'];
const ID_ALIASES = ['commodityid', 'id', 'code', 'commoditycode'];
const UNIT_ALIASES = ['unit', 'uom'];

export class StatementReadError extends Error {}

const commodityIndex = (): Map<string, Commodity> => {
  const m = new Map<string, Commodity>();
  for (const c of [...DSS_A, ...DSS_B, ...CRS29_STOCK]) {
    m.set(key(c.id), c);
    m.set(key(c.en), c);
    m.set(key(c.ta), c);
  }
  return m;
};

/**
 * Read a monthly statement workbook.
 *
 * Accepts the sheet this app writes, and any workbook whose table carries
 * recognisable headings — matched by name, so a different column order or a
 * few extra columns are fine. Throws StatementReadError with a message meant
 * for the person who chose the file.
 */
export async function readMonthlyStatement(file: File): Promise<PvMonthData> {
  const xlsx = await loadXlsx();
  let wb: { SheetNames: string[]; Sheets: Record<string, Sheet> };
  try {
    wb = xlsx.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  } catch {
    throw new StatementReadError(`${file.name} could not be opened as a spreadsheet. Upload the .xlsx monthly statement.`);
  }
  if (!wb.SheetNames.length) throw new StatementReadError(`${file.name} has no sheets in it.`);

  const comms = commodityIndex();

  for (const name of wb.SheetNames) {
    const grid = xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' }) as unknown[][];
    if (!grid.length) continue;

    // Labelled fields anywhere above or beside the table.
    let crsId = 0;
    let crsName = '';
    let month = 0;
    let year = 0;
    for (const row of grid) {
      for (let c = 0; c < row.length - 1; c++) {
        const k = key(row[c]);
        const v = row[c + 1];
        if (!k) continue;
        if (!crsId && (k === 'crsnumber' || k === 'crsno' || k === 'crsid' || k === 'crs')) crsId = num(v);
        else if (!crsName && (k === 'crsshop' || k === 'shopname' || k === 'crsname')) crsName = norm(v);
        else if (!month && k === 'monthnumber') month = num(v);
        else if (!month && k === 'month') {
          const mi = MNAMES.findIndex((m) => m && key(m) === key(v));
          month = mi > 0 ? mi : num(v);
        } else if (!year && k === 'year') year = num(v);
      }
    }

    // The header row is the one naming a commodity column and at least three
    // of the figure columns — never row 0 by assumption.
    let headerRow = -1;
    let cols: Record<string, number> = {};
    for (let r = 0; r < grid.length && headerRow === -1; r++) {
      const found: Record<string, number> = {};
      grid[r].forEach((cell, c) => {
        const k = key(cell);
        if (!k) return;
        if (found.name === undefined && NAME_ALIASES.includes(k)) found.name = c;
        if (found.commId === undefined && ID_ALIASES.includes(k)) found.commId = c;
        if (found.unit === undefined && UNIT_ALIASES.includes(k)) found.unit = c;
        for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
          if (found[field] === undefined && aliases.includes(k)) found[field] = c;
        }
      });
      const figures = Object.keys(FIELD_ALIASES).filter((f) => found[f] !== undefined).length;
      if (found.name !== undefined && figures >= 3) {
        headerRow = r;
        cols = found;
      }
    }
    if (headerRow === -1) continue; // try the next sheet

    const rows: PvMonthRow[] = [];
    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r];
      const label = norm(row[cols.name]);
      if (!label) continue;
      if (/^(total|grand total|sub total)$/i.test(label)) continue; // totals are recomputed, never read

      const rawId = cols.commId !== undefined ? norm(row[cols.commId]) : '';
      const match = comms.get(key(rawId)) ?? comms.get(key(label));
      const commId = match?.id ?? rawId;
      if (!commId) continue; // a decoration row, not a commodity

      const pick = (f: keyof typeof FIELD_ALIASES) => (cols[f] !== undefined ? num(row[cols[f]]) : 0);
      const open = pick('open');
      const receipt = pick('receipt');
      const sales = pick('sales');
      rows.push({
        commId,
        name: match?.en ?? label,
        unit: cols.unit !== undefined ? norm(row[cols.unit]) || match?.unit || 'KG' : match?.unit ?? 'KG',
        open,
        receipt,
        // Totals are derived, not trusted: a stored total that disagrees with
        // its own parts is exactly how a wrong figure survives a copy.
        total: open + receipt,
        sales,
        closing: open + receipt - sales,
        amount: pick('amount'),
      });
    }

    if (!rows.length) continue;
    if (!month || !year) {
      throw new StatementReadError(`${file.name} does not say which month and year it covers. Export it again from Reports → Monthly → PV Data (Excel).`);
    }
    if (!crsId) {
      throw new StatementReadError(`${file.name} does not say which CRS shop it belongs to. Export it again from Reports → Monthly → PV Data (Excel).`);
    }
    return { crsId, crsName, month, year, rows };
  }

  throw new StatementReadError(
    `${file.name} does not look like a monthly statement — no table with Commodity, Opening, Receipt, Sales and Closing headings was found.`,
  );
}

/**
 * Consolidate months into one PV, in the order given (which the caller has
 * already sorted chronologically).
 *
 * Opening and Closing are stock BALANCES, not flows: the period opens where
 * its first month opened and closes where its last month closed. Receipt,
 * Sales and Amount are flows and do add up. Summing a balance is the classic
 * way to produce a PV that is wrong by a whole quarter.
 */
export function consolidateMonths(months: PvMonthData[]): PvMonthRow[] {
  const out = new Map<string, PvMonthRow>();
  months.forEach((m, i) => {
    for (const r of m.rows) {
      const cur = out.get(r.commId);
      if (!cur) {
        out.set(r.commId, { ...r, total: 0, closing: 0 });
        continue;
      }
      cur.receipt += r.receipt;
      cur.sales += r.sales;
      cur.amount += r.amount;
      if (i === 0) cur.open = r.open; // only the first month sets the opening
    }
  });
  // Closing follows the arithmetic rather than the last sheet's own figure, so
  // the PV always adds up: open + receipt − sales.
  for (const r of out.values()) {
    r.total = r.open + r.receipt;
    r.closing = r.total - r.sales;
  }
  return [...out.values()];
}
