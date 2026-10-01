/**
 * The OAP / APS / ANP statement (office, 2026-10-01) — a separate one-page
 * sheet per shop for the old-age / destitute pension rice lines, in the
 * office's own layout ("OAP & ANP", CRS 19 AUG'26):
 *
 *   COMMODITY | O.B | RECEIPT | SHORTAGE | TOTAL | SALES | C.B
 *
 * Kept apart from the statutory statement engine (its sections, goldens and
 * paywall are untouched); the figures are the month exactly as Monthly Sales
 * publishes it (rebuildMonthlyFromDaily — Daily and Monthly Entry alike), so
 * an edit on either shows here at once and nothing is cached.
 *
 * - The family is read from the Commodity Master: every commodity whose code
 *   is OAP…, APS… or ANP… (OAP, APS — the POS's "ANP" —, OAP_FRK today;
 *   ANP, APS_FRK, ANP_FRK the moment the office adds them).
 * - A shop is on the statement for a commodity only when that commodity has
 *   an entry there that month: some Opening, Receipt, Shortage, Sales or
 *   Closing that is not zero. Nothing else is listed.
 * - TOTAL and C.B are the month's own (Opening + Receipt ± adjustments, and
 *   Total − Sales), so this sheet can never disagree with Monthly Sales; with
 *   no shortage that is O.B + RECEIPT and TOTAL − SALES, as the form reads.
 */
import { rebuildMonthlyFromDaily } from '@/lib/engine/monthlyRollup';
import type { Commodity } from '@/lib/engine/commodities';

export const OAP_FAMILY = /^(OAP|APS|ANP)(_|$)/;

/** A commodity code as the form prints it: OAP_FRK → "OAP FRK". */
export const oapLabel = (id: string) => id.replace(/_/g, ' ');

/** The family, in Commodity Master order, from a list of commodities (Section A). */
export function oapFamily(list: Commodity[]): Commodity[] {
  return list.filter((c) => OAP_FAMILY.test(c.id));
}

export type OapRow = { id: string; label: string; open: number; receipt: number; shortage: number; total: number; sales: number; close: number };
export type OapSheet = { crsId: number; rows: OapRow[] };

type Stores = {
  entryStore: Record<string, unknown>;
  inspectionStore: Record<string, unknown>;
  meManualStore: Record<string, unknown>;
  receiptStore: unknown[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * One shop's sheet for the chosen commodities — or null when none of them has
 * an entry there that month. `lists` is the shop's own commodity list
 * (commodityListsFor), so a commodity added on the Commodity Master is read.
 */
export function oapSheetFor(
  stores: Stores,
  crsId: number,
  month: number,
  year: number,
  ids: string[],
  lists: { a: Commodity[]; b: Commodity[] },
): OapSheet | null {
  const { merged } = rebuildMonthlyFromDaily(
    crsId, month, year,
    stores.entryStore as never, stores.inspectionStore as never,
    (stores.meManualStore as Record<string, never>)[`${crsId}_${month}_${year}`],
    lists, stores.receiptStore as never,
  );
  const rows: OapRow[] = [];
  for (const id of ids) {
    const r = merged.a[id];
    if (!r) continue;
    const open = Number(r.open) || 0, receipt = Number(r.receipt) || 0, shortage = Number(r.shortage) || 0, sales = Number(r.sales) || 0;
    const total = Number(r.total) || 0, close = Number(r.close) || 0;
    if (![open, receipt, shortage, sales, close, total].some((v) => Math.abs(v) > 0.0005)) continue;
    rows.push({ id, label: oapLabel(id), open: r3(open), receipt: r3(receipt), shortage: r3(shortage), total: r3(total), sales: r3(sales), close: r3(close) });
  }
  return rows.length ? { crsId, rows } : null;
}

/** "AUG'26" — the form's month, as the reference prints it. */
export function oapPeriod(month: number, year: number): string {
  const M = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${M[month]}'${String(year).slice(-2)}`;
}

/** A figure as the form prints it: whole numbers plain, else up to three places. */
export function oapNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);

/**
 * The sheet's own styles — government-file plain: black rules, bold headings,
 * the table across the page. Scoped to `.oap-sheet` so they reach nothing else.
 */
export const OAP_SHEET_CSS = [
  '.oap-sheet{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff;box-sizing:border-box}',
  '.oap-sheet h1{font-size:22px;font-weight:bold;text-align:center;margin:0 0 18px;letter-spacing:.2px}',
  '.oap-sheet h2{font-size:18px;font-weight:bold;text-align:center;margin:0 0 10px}',
  '.oap-sheet .oap-meta{display:flex;justify-content:space-between;font-size:16px;font-weight:bold;margin:0 0 14px;padding:0 4px}',
  '.oap-sheet table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:16px}',
  '.oap-sheet th,.oap-sheet td{border:1.5px solid #000;padding:7px 6px;text-align:center}',
  // Its own colours and case, so the app's list-table styling cannot grey the headings on screen.
  '.oap-sheet th,.oap-sheet td{color:#000;background:#fff;text-transform:none;letter-spacing:0}',
  '.oap-sheet th{font-weight:bold;font-size:14px}',
  '.oap-sheet td.l{font-weight:bold}',
].join('');

/** One shop's sheet as HTML — the same markup on screen and on paper. */
export function oapSheetHtml(sheet: OapSheet, title: string, period: string): string {
  const head = ['COMMODITY', 'O.B', 'RECEIPT', 'SHORTAGE', 'TOTAL', 'SALES', 'C.B'];
  const body = sheet.rows
    .map((r) => `<tr><td class="l">${esc(r.label)}</td>${[r.open, r.receipt, r.shortage, r.total, r.sales, r.close].map((v) => `<td>${oapNum(v)}</td>`).join('')}</tr>`)
    .join('');
  return (
    `<div class="oap-sheet" data-crs="${sheet.crsId}">` +
    '<h1>TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</h1>' +
    `<h2>${esc(title)}</h2>` +
    `<div class="oap-meta"><span>CRS ${sheet.crsId}</span><span>${esc(period)}</span></div>` +
    `<table><colgroup><col style="width:22%">${'<col>'.repeat(6)}</colgroup><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>` +
    '</div>'
  );
}

/**
 * The print document: one A4 landscape page per shop, nothing of the app on
 * it. Every page is the same size and orientation, so one print job is right
 * on any printer, and "Save as PDF" gives the same pages.
 */
export function oapPrintDocument(sheets: { html: string }[], docTitle: string): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"/>' +
    `<title>${esc(docTitle)}</title>` +
    `<style>@page{size:A4 landscape;margin:14mm 16mm}html,body{margin:0;padding:0;background:#fff}${OAP_SHEET_CSS}` +
    '.oap-page{break-after:page;page-break-after:always;break-inside:avoid}.oap-page:last-child{break-after:auto;page-break-after:auto}</style>' +
    `</head><body>${sheets.map((s) => `<section class="oap-page">${s.html}</section>`).join('')}</body></html>`
  );
}
