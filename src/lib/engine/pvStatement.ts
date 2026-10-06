/**
 * Physical Verification (PV) statement — ported from 04-reports.js.
 *
 * Kept as an HTML-string builder on purpose: it is a printable government
 * form whose layout must not drift, and the print flow relies on the
 * #pv-print-area visibility trick. The React screen renders the string.
 *
 * Two data fixes over the legacy builder, both noted inline:
 *  - gunny rows read `opening` (the store's real field; the legacy `open`
 *    read undefined, so every PV printed gunny opening as 0);
 *  - receipt totals read `items[k].qty` (the legacy parseFloat(object) was
 *    always NaN, so period receipt totals were silently 0).
 */
import { CRS29_STOCK, DSS_A, DSS_B, isCrs29, type DayEntry } from '@/lib/engine/commodities';

export type PvCommRow = {
  name: string;
  unit: string;
  open: number;
  receipt: number;
  total: number;
  issues: number;
  closing: number;
  amount: number;
  free: boolean;
  _openSet?: boolean;
  /**
   * The 3-month PV built from uploaded months (pvQuarter.ts) knows these; the
   * automatic PV does not set them, so its sheet prints exactly as before.
   * Transfer is net (in +, out −). Shortage prints in "Shortage during the
   * period" (red), Excess in the Physical-verification "Excess" (green); both
   * are positive magnitudes, and TOTAL already includes the Excess.
   */
  transfer?: number;
  shortage?: number;
  excess?: number;
  /**
   * The period's BAG counts as Monthly Sales / Page 2 carry them (office,
   * 2026-10-06): Opening + Receipt = Total, Total − Issues = Balance. When
   * present the bag columns print these; absent, kgs ÷ pack as before.
   */
  bags?: { open: number; receipt: number; total: number; issues: number; closing: number };
};
export type PvAggregate = {
  commMap: Record<string, PvCommRow>;
  totalSales: number;
  totalReceipts: number;
  days: number;
};

/** What a published month holds per commodity, as far as the PV needs it. */
type MonthlyFigures = { open?: number; receipt?: number; sales?: number; amount?: number };

type Stores = {
  entryStore: Record<string, DayEntry>;
  receiptStore: { crsId: number; date: string; items?: Record<string, { qty: number }> }[];
  monthlyStore: Record<string, { a?: Record<string, MonthlyFigures>; b?: Record<string, MonthlyFigures> }>;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const allComms = () => [...DSS_A, ...DSS_B];

/**
 * The commodities a shop's PV may carry.
 *
 * CRS 29 (Refugee Camp) stocks its own seven lines plus the two paid packing
 * ones, and has no police section at all — the Daily and Monthly reports have
 * always scoped it that way, but the PV path did not, so a CRS 29 PV could
 * print police commodities the shop does not sell. The scope is applied while
 * accumulating rather than when rendering, so an out-of-scope line cannot
 * reach the totals either.
 */
export function pvCommodityScope(crsId: number): Set<string> | null {
  if (!isCrs29(crsId)) return null; // every other shop carries the full list
  return new Set([...CRS29_STOCK.map((c) => c.id), 'EMPTY_BAG', 'EMPTY_BOX']);
}

export function pvAggregatePeriod(
  crsIds: number[],
  months: { year: number; month: number }[],
  stores: Stores,
  /** Commodity ids the PV may include; null means all. */
  scope: Set<string> | null = null,
): PvAggregate {
  const commMap: Record<string, PvCommRow> = {};
  let totalSales = 0;
  let totalReceipts = 0;
  const daysSet = new Set<string>();

  for (const cid of crsIds) {
    for (const ym of months) {
      const daysInMo = new Date(ym.year, ym.month, 0).getDate();
      for (let d = 1; d <= daysInMo; d++) {
        const dk = `${cid}_${ym.year}-${pad2(ym.month)}-${pad2(d)}`;
        const e = stores.entryStore[dk];
        if (!e) continue;
        daysSet.add(dk);
        for (const sec of ['a', 'b'] as const) {
          for (const [commId, row] of Object.entries(e[sec] ?? {})) {
            if (scope && !scope.has(commId)) continue;
            const qty = Number(row.sales) || 0;
            const amt = Number(row.amount) || 0;
            totalSales += amt;
            if (!commMap[commId]) {
              const cm = allComms().find((x) => x.id === commId);
              commMap[commId] = {
                name: cm?.en ?? commId, unit: cm?.unit ?? 'KG',
                open: 0, receipt: 0, total: 0, issues: 0, closing: 0, amount: 0,
                free: !!cm?.free,
              };
            }
            commMap[commId].issues += qty;
            commMap[commId].amount += amt;
          }
        }
      }
      for (const r of stores.receiptStore) {
        if (!crsIds.includes(r.crsId)) continue;
        const [ry, rm] = r.date.split('-').map(Number);
        if (ry !== ym.year || rm !== ym.month) continue;
        for (const it of Object.values(r.items ?? {})) totalReceipts += Number(it?.qty) || 0;
      }
      for (const cid2 of crsIds) {
        const ms = stores.monthlyStore[`${cid2}_${ym.month}_${ym.year}`];
        if (!ms) continue;
        for (const sec of ['a', 'b'] as const) {
          for (const [commId, sv] of Object.entries(ms[sec] ?? {})) {
            if (scope && !scope.has(commId)) continue;
            // A shop that keys its month straight into Monthly Entry has no
            // day sheets, so nothing above created a row for it. Seeding from
            // the published month is what lets the PV be built from whatever
            // the shop actually keyed, rather than coming out blank for every
            // monthly-keyed shop.
            let row = commMap[commId];
            if (!row) {
              const cm = allComms().find((x) => x.id === commId);
              row = commMap[commId] = {
                name: cm?.en ?? commId, unit: cm?.unit ?? 'KG',
                open: 0, receipt: 0, total: 0, issues: 0, closing: 0, amount: 0,
                free: !!cm?.free,
              };
            }
            if (!row._openSet) {
              // Opening is a stock balance, not a flow: the period opens where
              // its FIRST month opened, and is never summed across months.
              row.open = Number(sv.open) || 0;
              row._openSet = true;
            }
            row.receipt += Number(sv.receipt) || 0;
            // Sales/amount come from the day sheets where they exist; take the
            // month's own figures only when no sheet spoke for this commodity.
            if (!daysSet.size) {
              row.issues += Number(sv.sales) || 0;
              const amt = Number(sv.amount) || 0;
              row.amount += amt;
              totalSales += amt;
            }
          }
        }
      }
    }
  }

  for (const row of Object.values(commMap)) {
    row.total = row.open + row.receipt;
    row.closing = Math.max(0, row.total - row.issues);
  }
  return { commMap, totalSales, totalReceipts, days: daysSet.size };
}

type GunnyMonth = Record<string, { opening?: number; receipt?: number; total?: number; issues?: number; closing?: number }>;

/**
 * The paper a PV is filed on: A4 or LEGAL, landscape — the office chooses on
 * the screen (office, 2026-10-06; it was Legal only, and an A4 printer shrank
 * the Legal sheet onto A4, which is why the print came out small).
 *
 * Margins are the printer's safe minimum (6 mm) on every side, and the sheet
 * is SCALED to fill what is left (pvFit.ts `fitPvSheet`): laid out narrower
 * and zoomed back out to the full printable width, so type, padding and row
 * height all grow by one factor — as far as the page height allows and no
 * cell is cut. Height still left goes into the commodity rows.
 *
 * Before that (office, 2026-09-28): LEGAL landscape, 14 × 8.5 in. The office's own workbook (`CRS 19 PV STATEMENT.xlsx`, sheet
 * "30.09.23" — Annexure-I) is `paperSize="5"` (Legal), landscape, 0.709 in at
 * each side, fit to one page, and every PV PDF the office has sent is
 * 355.6 × 215.9 mm, one page.
 *
 * The sheet is laid out in MILLIMETRES, never against the screen: on screen it
 * is a Legal page (the scroller around it scrolls), on paper the same table at
 * the same width, so the preview and the print are one layout.
 */
export type PvPaperSize = 'A4' | 'Legal';
export const PV_PAPERS: Record<PvPaperSize, { wMm: number; hMm: number; css: string }> = {
  A4: { wMm: 297, hMm: 210, css: 'A4 landscape' },
  Legal: { wMm: 355.6, hMm: 215.9, css: 'legal landscape' },
};
/** The printer's safe minimum, every side. */
export const PV_MARGIN_MM = 6;
/** The printable box of a paper: the page less the margins. */
export const pvPrintable = (p: PvPaperSize) => ({ wMm: PV_PAPERS[p].wMm - 2 * PV_MARGIN_MM, hMm: PV_PAPERS[p].hMm - 2 * PV_MARGIN_MM });

/**
 * The office's Annexure-I, column for column — 38 of them (B:AM of its sheet).
 * The old builder had 36: it had lost "Shortage during the year" and the PV
 * result's Excess / Shortage pair, while its title rows spanned 39 and its
 * number row ran to 38, so the numbers and the section rows stuck out past
 * the commodity rows on the right. Relative widths, in mm of the printed
 * table: the kgs columns take a 9-figure quantity (13312.000) at the sheet's
 * own type size; the columns the PV officer fills by hand are narrower.
 */
const PV_COL_MM = [
  6, 27.5, 7, 8, //              1 Sl · 2 Commodity · 3 Unit · 4 Stack No.
  6.5, 6.5, //                   5–6 Period From / To
  5.5, 8.5, 6.5, 13.5, 5.5, 7.5, // 7 Stack card · 8 Physical (the Opening) · 9 Shortage — bags, kgs
  6.5, 13.5, //                  10 Receipt
  14, //                         TRANSFER (kgs)
  6.5, 13.5, //                  TOTAL
  6.5, 13.5, //                  11 Issues
  6, 11, //                      12 Shortage during the period
  5.5, 5.5, 6.5, 5.5, 5, //      13 Qty expunged: RM ref · Date · Issue memo · Date · Qty
  6.5, 13.5, //                  14 Balance per stack card (the Closing)
  5.5, 7.5, //                   15 Shortage
  5.5, 8.5, 5.5, 8.5, //         16 By counting · By 100 %
  6, 11.1, //                    17 Excess
  5.5, 8.5, //                   18 Shortage
];
export const PV_COLS = PV_COL_MM.length; // 38

export function buildPVTable(opts: {
  commMap: Record<string, PvCommRow>;
  periodLabel: string;
  crsId: number;
  crsName: string;
  gunny: GunnyMonth;
  /**
   * The shop's own staff, as the users table assigns them (`shopStaffNames`,
   * staffAssignment.ts) — never the person signed in. A post nobody holds is
   * left out; a shop with neither keeps the ruled line for a hand-written name.
   */
  staff: { bc?: string; packer?: string };
  pvOfficer?: string;
  /** Already formatted DD-MM-YYYY; blank leaves the ruled line for the officer. */
  pvDate?: string;
  /**
   * Gunny classification notes as written in the uploaded Gunny sheets
   * ("WHEAT CONSIDER AS GUNNY") — printed under the Gunny section of THIS PV
   * only. None: no note line.
   */
  gunnyNotes?: string[];
  /** The NOTE row's text, as typed on the PV screen; blank leaves the space for a hand-written note. */
  note?: string;
  /** A4 (default) or Legal, landscape. */
  paper?: PvPaperSize;
}): string {
  const { commMap, periodLabel, crsId, crsName, gunny, staff, pvOfficer, pvDate, gunnyNotes, note } = opts;
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // One line per post the shop actually has, BC first — the statements' rule
  // (43-staff-posts.js). Neither: the Bill Clerk line with its ruled blank.
  const bcName = (staff?.bc ?? '').trim();
  const pkrName = (staff?.packer ?? '').trim();
  const staffLines = [
    bcName && `<b>NAME OF THE BILL CLERK :</b> ${escHtml(bcName)}`,
    pkrName && `<b>NAME OF THE P.K.R :</b> ${escHtml(pkrName)}`,
  ].filter(Boolean) as string[];
  if (!staffLines.length) staffLines.push('<b>NAME OF THE BILL CLERK :</b> ____________');
  const signerTitle = !bcName && pkrName ? 'P.K.R' : 'BILL CLERK';
  const fmtN = (v: number | undefined | null) => {
    if (v === undefined || v === null || v === 0) return '0';
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(3);
  };
  const fmtB = (kgs: number, div: number) => (!kgs ? '0' : String(Math.floor(kgs / (div || 50))));
  /** Transfer / shortage / excess — blank when the row does not carry them (the automatic PV). */
  const fmtT = (v: number | undefined) => (v === undefined ? '' : fmtN(v));

  // Empty Card+Box / Empty Polythene Bag are not commodity rows on the PV
  // (office, 2026-10-06): their stock is Gunny Stock Management's and prints
  // in the Gunny section as C.BOX / POLYTHENE. Left out here, so the
  // numbering runs on with no gap.
  const PV_NOT_COMMODITY = new Set(['EMPTY_BOX', 'EMPTY_BAG']);
  const mainComms = DSS_A.filter((c) => commMap[c.id] && !PV_NOT_COMMODITY.has(c.id)).map((c) => c.id);
  const policeComms = DSS_B.filter((c) => commMap[c.id]).map((c) => c.id);

  /** One cell. `cls`: `l` (a label), `short` (red), `excess` (green). */
  const td = (v: string | number | undefined, cls = '', span = 0) =>
    `<td${cls ? ` class="${cls}"` : ''}${span ? ` colspan="${span}"` : ''}>${v === undefined || v === null ? '' : v}</td>`;
  /** A shortage / excess figure takes its colour only when what it PRINTS is not zero (15 kg is 0 bags). */
  const tone = (shown: string | undefined, cls: string) => (shown && Number(shown) !== 0 ? cls : '');

  /** The figures a row prints; everything not named is a blank ruled cell. */
  type Cells = {
    obB?: string; obK?: string; recB?: string; recK?: string; tr?: string;
    totB?: string; totK?: string; issB?: string; issK?: string;
    shB?: string; shK?: string;
    balB?: string; balK?: string;
    exB?: string; exK?: string;
  };
  const dataRow = (sl: number, label: string, unit: string, c: Cells) =>
    '<tr>' +
    td(sl) + td(label, 'l') + td(unit) + td('') + //   1–4
    td('') + td('') + //                               5–6 Period
    td('') + td('') + //                               7 Stack card
    td(c.obB ?? '0') + td(c.obK ?? '0') + //           8 Physical balance — the Opening
    td('') + td('') + //                               9 Shortage (7−8)
    td(c.recB ?? '0') + td(c.recK ?? '0') + //         10 Receipt
    td(c.tr ?? '') + //                                TRANSFER
    td(c.totB ?? '0') + td(c.totK ?? '0') + //         TOTAL
    td(c.issB ?? '0') + td(c.issK ?? '0') + //         11 Issues
    td(c.shB ?? '', tone(c.shB, 'short')) + td(c.shK ?? '', tone(c.shK, 'short')) + // 12 Shortage during the period
    td('') + td('') + td('') + td('') + td('') + //    13 Qty expunged
    td(c.balB ?? '0') + td(c.balK ?? '0') + //         14 Balance — the Closing
    td('') + td('') + //                               15 Shortage
    td('') + td('') + td('') + td('') + //             16 Physical verification, by the officer
    td(c.exB ?? '', tone(c.exB, 'excess')) + td(c.exK ?? '', tone(c.exK, 'excess')) + // 17 Excess
    td('') + td('') + //                               18 Shortage
    '</tr>';
  const commodityRow = (sl: number, r: PvCommRow, div: number | null) => {
    // Police lines are kilos only: their bag columns print 0, as they always have.
    const b = (kgs: number) => (div === null ? '0' : fmtB(kgs, div));
    const g = div === null ? undefined : r.bags;
    return dataRow(sl, r.name, r.unit, {
      obB: g ? String(g.open) : b(r.open), obK: fmtN(r.open),
      recB: g ? String(g.receipt) : b(r.receipt), recK: fmtN(r.receipt),
      tr: fmtT(r.transfer),
      totB: g ? String(g.total) : b(r.total), totK: fmtN(r.total),
      issB: g ? String(g.issues) : b(r.issues), issK: fmtN(r.issues),
      shB: r.shortage === undefined ? '' : b(r.shortage), shK: fmtT(r.shortage),
      balB: g ? String(g.closing) : b(r.closing), balK: fmtN(r.closing),
      exB: r.excess === undefined ? '' : b(r.excess), exK: fmtT(r.excess),
    });
  };
  const sectionLabel = (text: string) => `<tr><td colspan="${PV_COLS}" class="l sec">${text}</td></tr>`;

  let rows = '';
  let sl = 1;
  for (const cid of mainComms) {
    const div = cid === 'PALM' ? 10 : cid === 'SALT_CIS' || cid === 'SALT_RFFS' ? 25 : 50;
    rows += commodityRow(sl++, commMap[cid], div);
  }
  rows += sectionLabel('Gunny');
  for (const [label, key] of [
    ['50 kg SS GUNNY', 'ss50'],
    ['POLYTHENE', 'poly'],
    ['C.BOX', 'cbox'],
  ] as const) {
    // Gunny is counted in pieces, so its figures print in the Bags columns.
    const g = gunny[key];
    rows += dataRow(sl++, label, 'NOS', {
      obB: g ? fmtN(g.opening) : '0', obK: '',
      recB: g ? fmtN(g.receipt) : '0', recK: '',
      totB: g ? fmtN(g.total) : '0', totK: '',
      issB: g ? fmtN(g.issues) : '0', issK: '',
      balB: g ? fmtN(g.closing) : '0', balK: '',
    });
  }
  // The Gunny section ends at C.BOX. The classification the office wrote
  // under its Gunny sheet ("WHEAT CONSIDER AS GUNNY") prints in the NOTE row
  // at the foot of the PV, once (office, 2026-10-06) — see noteLines below.
  if (policeComms.length) {
    rows += sectionLabel('Police');
    for (const cid of policeComms) rows += commodityRow(sl++, commMap[cid], null);
  }

  // The office's headings, cell for cell (sheet rows 9–12). The two short
  // captions the builder has always printed stay: "Issues [Excl. Shortage]"
  // (what the figure is here) and the period "Start" / "End" dates.
  const h = (text: string, cols = 1, rows = 1, cls = 'h7') =>
    `<td class="${cls}"${cols > 1 ? ` colspan="${cols}"` : ''}${rows > 1 ? ` rowspan="${rows}"` : ''}>${text}</td>`;
  const H = (text: string, cols = 1, rows = 1) => h(text, cols, rows, 'h8');
  const bk = () => h('Bags') + h('Kgs');
  const hdr =
    '<thead>' +
    `<tr><td colspan="${PV_COLS}" class="t1">TAMIL NADU CIVIL SUPPLIES CORPORATION – MADURAI REGION</td></tr>` +
    `<tr><td colspan="21" class="l t2"><b>NAME OF THE CRS :</b> ${crsId}${crsName ? ' — ' + crsName : ''}</td>` +
    `<td colspan="17" class="l t2"><b>NAME AND DESIGNATION OF THE P.V.OFFICER :</b> ${pvOfficer || '____________'}</td></tr>` +
    `<tr><td colspan="21" class="l t2">${staffLines.join('<br>')}</td>` +
    `<td colspan="17" class="l t2"><b>DATE OF P.V. :</b> ${pvDate || '____________'}</td></tr>` +
    `<tr><td colspan="${PV_COLS}" class="t3">PHYSICAL VERIFICATION REPORT OF COMMODITIES AS ON ${periodLabel}</td></tr>` +
    '<tr class="hd">' +
    H('Sl.<br>No.', 1, 3) + H('Commodity', 1, 3) + H('Unit', 1, 3) + H('Stack<br>No.', 1, 3) +
    H('Period', 2) + H('As on Start Date', 6) +
    H('Receipt', 2, 2) + H('TRANSFER', 1, 2) + H('TOTAL', 2, 2) + H('Issues [Excl. Shortage]', 2, 2) +
    H('Shortage during the period', 2, 2) + H('Qty Expunged', 5, 2) +
    H('Balance per Stack Card', 2, 2) + H('Shortage', 2, 2) + H('Physical Verification (End Date)', 8) +
    '</tr>' +
    '<tr class="hd">' +
    h('From', 1, 2) + h('To', 1, 2) + h('Stack card', 2) + h('Physical', 2) + h('Shortage (7-8)', 2) +
    h('By Counting', 2) + h('By 100%', 2) + h('Excess', 2) + h('Shortage', 2) +
    '</tr>' +
    '<tr class="hd">' +
    bk() + bk() + bk() + //                                    7 · 8 · 9
    bk() + h('KGS') + bk() + bk() + bk() + //                  10 · TRANSFER · TOTAL · 11 · 12
    h('RM ref') + h('Date') + h('Issue') + h('Date') + h('Qty') + // 13
    bk() + bk() + bk() + bk() + bk() + bk() + //               14 · 15 · 16 · 17 · 18
    '</tr>' +
    // The office's column numbers: one per heading, not one per cell.
    '<tr class="hd num">' +
    h('1') + h('2') + h('3') + h('4') + h('5') + h('6') +
    h('7', 2) + h('8', 2) + h('9', 2) + h('10', 2) + h('') + h('', 2) +
    h('11', 2) + h('12', 2) + h('13', 5) + h('14', 2) + h('15', 2) + h('16', 4) + h('17', 2) + h('18', 2) +
    '</tr>' +
    '</thead>';

  // The NOTE row's lines: the Gunny sheet's notes as written, then what was
  // typed on the PV screen — each once (case and spacing ignored).
  const noteLines: string[] = [];
  const seenNote = new Set<string>();
  for (const n of [...(gunnyNotes ?? []), ...(note ?? '').split('\n')]) {
    const t = n.trim();
    const k = t.toUpperCase().replace(/\s+/g, ' ');
    if (!t || seenNote.has(k)) continue;
    seenNote.add(k);
    noteLines.push(t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  }
  const footer =
    '<tfoot>' +
    // The NOTE row (office, 2026-10-06): one full-width ruled cell, "NOTE:"
    // in bold, then the notes — as tall as they are and no taller: one line
    // for one note (or none), a numbered line each for several.
    `<tr class="pv-note"><td colspan="${PV_COLS}" class="l f note"><b>NOTE:</b>${
      noteLines.length === 1
        ? ` <span class="note-text">${noteLines[0]}</span>`
        : noteLines.length
          ? ` <span class="note-text">${noteLines.map((t, i) => `${i + 1}. ${t}`).join('<br>')}</span>`
          : ''
    }</td></tr>` +
    '<tr><td colspan="21" class="l f wrap">' +
    '1. Certified that the details were verified with connected records and found correct.<br>' +
    '2. Certified that the result of the physical verification have been recorded in the stock ledger, stack register and stack card.' +
    '</td>' +
    '<td colspan="17" class="f wrap"><br><br><b>SIGNATURE OF THE PHYSICAL VERIFICATION OFFICER</b></td></tr>' +
    `<tr><td colspan="21" class="f sig"><b>SIGNATURE OF ${signerTitle} WITH SEAL</b></td>` +
    '<td colspan="17" class="f"></td></tr>' +
    '</tfoot>';

  const total = PV_COL_MM.reduce((a, b) => a + b, 0);
  const colgroup = '<colgroup>' + PV_COL_MM.map((w) => `<col style="width:${((w / total) * 100).toFixed(4)}%">`).join('') + '</colgroup>';
  const paper: PvPaperSize = opts.paper === 'Legal' ? 'Legal' : 'A4';
  const P = PV_PAPERS[paper];
  const box = pvPrintable(paper);
  const M = PV_MARGIN_MM;

  const css =
    // The sheet. Its own rules, scoped to it, so the app's table styles
    // (globals.css) cannot reach a cell and the paper is the same everywhere.
    `#pv-print-area .pv-paper{box-sizing:border-box;width:${P.wMm}mm;height:${P.hMm}mm;padding:${M}mm;` +
    'margin:0 auto;background:#fff;color:#000;box-shadow:0 1px 6px rgba(15,23,42,.18)}' +
    '#pv-tbl{width:100%;table-layout:fixed;border-collapse:collapse;font-family:Arial,sans-serif;color:#000}' +
    // The fitted width (pvFit.ts) is the table's own: print.css's
    // `max-width:100%` for wide screen tables must not undo it.
    '#pv-print-area #pv-tbl{max-width:none!important;min-width:0!important}' +
    // Height left on the page after scaling goes into the commodity rows.
    '#pv-tbl tbody td{padding-top:calc(1px + var(--pv-xpad,0px));padding-bottom:calc(1px + var(--pv-xpad,0px))}' +
    '#pv-tbl td{border:1px solid #000;padding:1px 0.5px;text-align:center;vertical-align:middle;font-size:8.5px;white-space:nowrap;overflow:hidden}' +
    '#pv-tbl td.l{text-align:left;font-weight:600;padding-left:4px}' +
    '#pv-tbl td.sec{font-weight:700;font-size:9px;background:#F5F5F5}' +
    '#pv-tbl .t1{font-weight:800;font-size:15px;letter-spacing:.02em;padding:5px 4px}' +
    '#pv-tbl .t2{font-weight:400;font-size:9px;padding:3px 8px}' +
    '#pv-tbl .t3{font-weight:700;font-size:10.5px;padding:3px}' +
    '#pv-tbl tr.hd td{background:#F5F5F5;white-space:normal;line-height:1.15}' +
    '#pv-tbl td.h8{font-size:8px;font-weight:700}' +
    '#pv-tbl td.h7{font-size:7px}' +
    '#pv-tbl tr.num td{padding:0 1px}' +
    '#pv-tbl td.f{font-size:9px;font-weight:400;padding:5px 10px;text-align:left}' +
    '#pv-tbl td.f.wrap{white-space:normal}' +
    '#pv-tbl td.f:not(.l){text-align:center}' +
    '#pv-tbl td.sig{padding-top:14px}' +
    // The NOTE row: wraps, top-aligned, exactly as tall as its notes.
    '#pv-tbl td.note{white-space:normal;vertical-align:top;padding:3px 8px;line-height:1.35;word-wrap:break-word;overflow-wrap:anywhere}' +
    '#pv-tbl td.note b{font-weight:800;margin-right:6px}' +
    '#pv-tbl tr.pv-note{break-inside:avoid;page-break-inside:avoid}' +
    // Shortage red, Excess green — the figure only, never the row.
    '#pv-tbl td.short{color:#DC2626}' +
    '#pv-tbl td.excess{color:#15803D}' +
    // Printed from the screen it is read on: the app hidden, the sheet at the
    // top-left of the chosen page inside its margins, at exactly the width and
    // scale it has on screen. ABSOLUTE, not fixed: a fixed element prints its
    // first page and nothing after it.
    '@media print{' +
    `@page{size:${P.css};margin:${M}mm}` +
    'body *{visibility:hidden}#pv-print-area,#pv-print-area *{visibility:visible}' +
    '#pv-print-area{position:absolute;top:0;left:0;width:100%;z-index:9999;padding:0}' +
    '#pv-print-area .pv-scroll{overflow:visible!important}' +
    `#pv-print-area .pv-paper{width:${box.wMm}mm;height:auto;padding:0;margin:0;box-shadow:none;overflow:visible}` +
    '#pv-tbl td{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '}';

  return (
    '<div id="pv-print-area">' +
    `<style>${css}</style>` +
    // On screen: the chosen page, scrolled sideways inside the card when the
    // window is narrower — the page never gives way to the window.
    '<div class="pv-scroll" style="overflow-x:auto;padding:4px 0 10px">' +
    `<div class="pv-paper" data-paper="${paper}" data-pw="${box.wMm}" data-ph="${box.hMm}"><div class="pv-fit">` +
    `<table id="pv-tbl">${colgroup}${hdr}<tbody>${rows}</tbody>${footer}</table>` +
    '</div></div></div></div>'
  );
}
