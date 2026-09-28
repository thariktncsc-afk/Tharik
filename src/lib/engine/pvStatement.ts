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
 * The paper a PV is filed on: LEGAL landscape, 14 × 8.5 in (office,
 * 2026-09-28). The office's own workbook (`CRS 19 PV STATEMENT.xlsx`, sheet
 * "30.09.23" — Annexure-I) is `paperSize="5"` (Legal), landscape, 0.709 in at
 * each side, fit to one page, and every PV PDF the office has sent is
 * 355.6 × 215.9 mm, one page.
 *
 * The sheet is laid out in MILLIMETRES, never against the screen: on screen it
 * is a Legal page (the scroller around it scrolls), on paper the same table at
 * the same width, so the preview and the print are one layout.
 */
export const PV_PAPER = { wMm: 355.6, hMm: 215.9, marginXMm: 18, marginYMm: 12 } as const;
/** The table's printed width: the page less the office's side margins (18 mm = its 0.709 in). */
export const PV_TABLE_MM = PV_PAPER.wMm - 2 * PV_PAPER.marginXMm;

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
  billClerk: string;
  pvOfficer?: string;
  /** Already formatted DD-MM-YYYY; blank leaves the ruled line for the officer. */
  pvDate?: string;
  /**
   * Gunny classification notes as written in the uploaded Gunny sheets
   * ("WHEAT CONSIDER AS GUNNY") — printed under the Gunny section of THIS PV
   * only. None: no note line.
   */
  gunnyNotes?: string[];
}): string {
  const { commMap, periodLabel, crsId, crsName, gunny, billClerk, pvOfficer, pvDate, gunnyNotes } = opts;
  const fmtN = (v: number | undefined | null) => {
    if (v === undefined || v === null || v === 0) return '0';
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(3);
  };
  const fmtB = (kgs: number, div: number) => (!kgs ? '0' : String(Math.floor(kgs / (div || 50))));
  /** Transfer / shortage / excess — blank when the row does not carry them (the automatic PV). */
  const fmtT = (v: number | undefined) => (v === undefined ? '' : fmtN(v));

  const mainComms = DSS_A.filter((c) => commMap[c.id]).map((c) => c.id);
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
    return dataRow(sl, r.name, r.unit, {
      obB: b(r.open), obK: fmtN(r.open),
      recB: b(r.receipt), recK: fmtN(r.receipt),
      tr: fmtT(r.transfer),
      totB: b(r.total), totK: fmtN(r.total),
      issB: b(r.issues), issK: fmtN(r.issues),
      shB: r.shortage === undefined ? '' : b(r.shortage), shK: fmtT(r.shortage),
      balB: b(r.closing), balK: fmtN(r.closing),
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
  // The classification the office wrote under its Gunny sheet, as written —
  // "WHEAT CONSIDER AS GUNNY" — so the PV says how its Gunny was counted.
  const notes = (gunnyNotes ?? []).map((n) => n.trim()).filter(Boolean);
  if (notes.length) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    rows += `<tr class="pv-gunny-note"><td colspan="${PV_COLS}" class="l">Note: ${notes.map(esc).join('; ')}</td></tr>`;
  }
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
    `<tr><td colspan="${PV_COLS}" class="t1">TAMIL NADU CIVIL SUPPLIES CORPORATION MADURAI REGION</td></tr>` +
    `<tr><td colspan="21" class="l t2"><b>NAME OF THE CRS :</b> ${crsId}${crsName ? ' — ' + crsName : ''}</td>` +
    `<td colspan="17" class="l t2"><b>NAME AND DESIGNATION OF THE P.V.OFFICER :</b> ${pvOfficer || '____________'}</td></tr>` +
    `<tr><td colspan="21" class="l t2"><b>NAME OF THE BILL CLERK :</b> ${billClerk}</td>` +
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

  const footer =
    '<tfoot>' +
    `<tr><td colspan="${PV_COLS}" class="l f">NOTE:</td></tr>` +
    '<tr><td colspan="21" class="l f wrap">' +
    '1. Certified that the details were verified with connected records and found correct.<br>' +
    '2. Certified that the result of the physical verification have been recorded in the stock ledger, stack register and stack card.' +
    '</td>' +
    '<td colspan="17" class="f wrap"><br><br><b>SIGNATURE OF THE PHYSICAL VERIFICATION OFFICER</b></td></tr>' +
    '<tr><td colspan="21" class="f sig"><b>SIGNATURE OF BILL CLERK WITH SEAL</b></td>' +
    '<td colspan="17" class="f"></td></tr>' +
    '</tfoot>';

  const total = PV_COL_MM.reduce((a, b) => a + b, 0);
  const colgroup = '<colgroup>' + PV_COL_MM.map((w) => `<col style="width:${((w / total) * 100).toFixed(4)}%">`).join('') + '</colgroup>';
  const P = PV_PAPER;

  const css =
    // The sheet. Its own rules, scoped to it, so the app's table styles
    // (globals.css) cannot reach a cell and the paper is the same everywhere.
    `#pv-print-area .pv-paper{box-sizing:border-box;width:${P.wMm}mm;min-height:${P.hMm}mm;padding:${P.marginYMm}mm ${P.marginXMm}mm;` +
    'margin:0 auto;background:#fff;color:#000;box-shadow:0 1px 6px rgba(15,23,42,.18)}' +
    '#pv-tbl{width:100%;table-layout:fixed;border-collapse:collapse;font-family:Arial,sans-serif;color:#000}' +
    '#pv-tbl td{border:1px solid #000;padding:1px 2px;text-align:center;vertical-align:middle;font-size:8.5px;white-space:nowrap;overflow:hidden}' +
    '#pv-tbl td.l{text-align:left;font-weight:600;padding-left:5px}' +
    '#pv-tbl td.sec{font-weight:700;font-size:9px;background:#F5F5F5}' +
    '#pv-tbl .t1{font-weight:800;font-size:11px;padding:4px}' +
    '#pv-tbl .t2{font-weight:400;font-size:9px;padding:3px 8px}' +
    '#pv-tbl .t3{font-weight:700;font-size:10px;padding:3px}' +
    '#pv-tbl tr.hd td{background:#F5F5F5;white-space:normal;line-height:1.15}' +
    '#pv-tbl td.h8{font-size:8px;font-weight:700}' +
    '#pv-tbl td.h7{font-size:7px}' +
    '#pv-tbl tr.num td{padding:0 1px}' +
    '#pv-tbl td.f{font-size:9px;font-weight:400;padding:5px 10px;text-align:left}' +
    '#pv-tbl td.f.wrap{white-space:normal}' +
    '#pv-tbl td.f:not(.l){text-align:center}' +
    '#pv-tbl td.sig{padding-top:14px}' +
    // Shortage red, Excess green — the figure only, never the row.
    '#pv-tbl td.short{color:#DC2626}' +
    '#pv-tbl td.excess{color:#15803D}' +
    // Printed from the screen it is read on: the app hidden, the sheet at the
    // top-left of a LEGAL landscape page with the office's side margins, and
    // the table the width it has on screen (PV_TABLE_MM). ABSOLUTE, not fixed:
    // a fixed element prints its first page and nothing after it.
    '@media print{' +
    `@page{size:legal landscape;margin:${P.marginYMm}mm ${P.marginXMm}mm}` +
    'body *{visibility:hidden}#pv-print-area,#pv-print-area *{visibility:visible}' +
    '#pv-print-area{position:absolute;top:0;left:0;width:100%;z-index:9999;padding:0}' +
    '#pv-print-area .pv-scroll{overflow:visible!important}' +
    `#pv-print-area .pv-paper{width:${PV_TABLE_MM.toFixed(1)}mm;min-height:0;padding:0;margin:0;box-shadow:none}` +
    '#pv-tbl td{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '}';

  return (
    '<div id="pv-print-area">' +
    `<style>${css}</style>` +
    // On screen: a Legal page, scrolled sideways inside the card when the
    // window is narrower than 14 in — the page never gives way to the window.
    '<div class="pv-scroll" style="overflow-x:auto;padding:4px 0 10px">' +
    '<div class="pv-paper">' +
    `<table id="pv-tbl">${colgroup}${hdr}<tbody>${rows}</tbody>${footer}</table>` +
    '</div></div></div>'
  );
}
