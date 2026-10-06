/**
 * Which pack a commodity's sales empty into, and how many (office,
 * 2026-09-30). ONE rule for the Gunny Stock screen, the month-close, Daily
 * Entry's save, the server's rule 5 and — in legacy form, 42-gunny-live.js —
 * the statements. `npm run verify:gunny-receipt`.
 *
 *   GUNNY (50 KG SS)  BRA, AAY, AAY FRK, NPHH FRK, PHH FRK, PHH BRA, RRA,
 *                     NPHH FRK RRA, WHEAT, T.DHALL (+ OAP, APS and police BRA)
 *   POLY              SUGAR, AAY SUGAR, SALT (CIS), SALT (RFFS)
 *   C.BOX             P.OIL, OOTY, TAN
 *
 * Exactly the rows that HAVE a bag box on the Monthly Sales grid. Police
 * sugar / wheat / dhall / palm oil have none there (NO_GUNNY,
 * monthly-entry/lib.ts), so they are not counted here either — a bag Gunny
 * counted that Monthly Sales does not show would be a mismatch (office,
 * 2026-09-30). Live: no month has a police sale that fills a pack.
 *
 * WHEAT, RRA, NPHH FRK RRA (and police BRA) can come in poly bags instead:
 * the Receipt page's Gunny / Poly switch says so, and it is now SAVED on the
 * receipt (`items[id].pack`). A month counts such a commodity as the latest
 * receipt of it DATED IN THAT MONTH says; a month with none, or a receipt
 * saved before the switch was kept, counts it as Gunny.
 *
 * Count = the month's SALES of the commodity ÷ its pack size, rounded down —
 * bagsOf (engine/commodities.ts), the same divisor the grids' bag columns use:
 * 50 kg a sack or a sugar poly, 25 a salt poly, 10 palm-oil packets a box, 50
 * tea packets a box. Per commodity, on the month's total.
 *
 * MONTHLY SALES IS THE SOURCE (office, 2026-09-30, second instruction): the
 * Gunny Receipt is the SUM OF THE BAG COUNTS MONTHLY SALES SHOWS in its Sales
 * column, by pack — nothing else. `salesBags` is that count for one row (the
 * grid's own rule: the office's stored count where it keyed one that differs,
 * else sales ÷ pack size), so the two screens cannot disagree. A Receipt typed
 * into Gunny Stock Management (`receiptImported`) is no longer read: CRS 5
 * September showed 236 / 23 from one while Monthly Sales said 227 / 28.
 */
import { bagsOf } from '@/lib/engine/commodities';
import type { ReceiptRow } from '@/lib/engine/receiptRollup';

export type PackType = 'GUNNY' | 'POLY' | 'CBOX';

export const PACK_BASE: Record<string, PackType> = {
  BRA: 'GUNNY', AAY: 'GUNNY', AAY_FRK: 'GUNNY', NPHH_FRK: 'GUNNY', PHH_FRK: 'GUNNY', PHH_BRA: 'GUNNY',
  RRA: 'GUNNY', NPHH_RRA: 'GUNNY', WHEAT: 'GUNNY', TOOR: 'GUNNY', OAP: 'GUNNY', OAP_FRK: 'GUNNY', APS: 'GUNNY',
  PB_BRA: 'GUNNY',
  SUGAR: 'POLY', AAY_SUGAR: 'POLY', SALT_CIS: 'POLY', SALT_RFFS: 'POLY',
  PALM: 'CBOX', OOTY: 'CBOX', TAN: 'CBOX',
};

/** The Receipt page's Gunny ↔ Poly switch applies to these alone. */
export const PACK_SWITCHABLE = new Set(['WHEAT', 'RRA', 'NPHH_RRA', 'PB_BRA']);

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The switch as saved on one receipt line, if it was. */
export function receiptPackOf(item: unknown): 'GUNNY' | 'POLY' | null {
  const p = item && typeof item === 'object' ? (item as { pack?: unknown }).pack : null;
  return p === 'POLY' || p === 'GUNNY' ? p : null;
}

/** The month's pack type for every commodity: the base, with the switchable ones as the month's latest receipt says. */
export function packTypesFor(receiptStore: ReceiptRow[] | undefined, crsId: number, month: number, year: number): Record<string, PackType> {
  const out: Record<string, PackType> = { ...PACK_BASE };
  const prefix = `${year}-${pad2(month)}-`;
  const rows = (receiptStore ?? [])
    .filter((r) => Number(r.crsId) === Number(crsId) && typeof r.date === 'string' && r.date.startsWith(prefix))
    .sort((a, b) => (a.date === b.date ? (Number((a as { id?: unknown }).id) || 0) - (Number((b as { id?: unknown }).id) || 0) : a.date < b.date ? -1 : 1));
  for (const id of PACK_SWITCHABLE) {
    let latest: 'GUNNY' | 'POLY' | null | undefined;
    for (const r of rows) {
      const item = (r.items as Record<string, unknown> | undefined)?.[id];
      if (item === undefined) continue;
      latest = receiptPackOf(item); // a receipt without a saved switch says Gunny
    }
    if (latest !== undefined) out[id] = latest ?? 'GUNNY';
  }
  return out;
}

/**
 * The bag count Monthly Sales shows in one commodity's SALES column
 * (monthly-entry/page.tsx rowFor): the stored count where it is the office's
 * own — above zero and not what the division gives — else sales ÷ pack size.
 */
export function salesBags(row: { sales?: unknown; g_sales?: unknown } | undefined, id: string): number {
  const auto = bagsOf(Number(row?.sales) || 0, id);
  const stored = Math.round(Number(row?.g_sales) || 0);
  return stored > 0 && stored !== auto ? stored : auto;
}

/** Every commodity's Monthly Sales bag count, from a published month (monthlyStore[key]). */
export function monthSalesBags(block: { a?: Record<string, unknown>; b?: Record<string, unknown> } | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sec of ['a', 'b'] as const) {
    for (const [id, row] of Object.entries(block?.[sec] ?? {})) out[id] = salesBags(row as { sales?: unknown; g_sales?: unknown }, id);
  }
  return out;
}

/**
 * Packs emptied by the month's sales, per type: the sum of Monthly Sales' bag
 * counts. `bags` is those counts where the caller has them (the grid's own
 * figures on screen, monthSalesBags elsewhere); a commodity it does not name
 * is counted as sales ÷ pack size.
 */
export function packCounts(sales: Record<string, number>, types: Record<string, PackType> = PACK_BASE, bags?: Record<string, number>): Record<PackType, number> {
  const out: Record<PackType, number> = { GUNNY: 0, POLY: 0, CBOX: 0 };
  for (const [id, type] of Object.entries(types)) {
    out[type] += bags && bags[id] !== undefined ? Math.round(Number(bags[id]) || 0) : bagsOf(Number(sales[id]) || 0, id);
  }
  return out;
}
