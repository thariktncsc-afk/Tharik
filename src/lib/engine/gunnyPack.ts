/**
 * Which pack a commodity's sales empty into, and how many (office,
 * 2026-09-30). ONE rule for the Gunny Stock screen, the month-close, Daily
 * Entry's save, the server's rule 5 and — in legacy form, 42-gunny-live.js —
 * the statements. `npm run verify:gunny-receipt`.
 *
 *   GUNNY (50 KG SS)  BRA, AAY, AAY FRK, NPHH FRK, PHH FRK, PHH BRA, RRA,
 *                     NPHH FRK RRA, WHEAT, T.DHALL (+ OAP, APS and the police
 *                     rice / wheat / dhall, as the engine always counted them)
 *   POLY              SUGAR, AAY SUGAR, SALT (CIS), SALT (RFFS) (+ police sugar)
 *   C.BOX             P.OIL, OOTY, TAN (+ police palm oil)
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
 */
import { bagsOf } from '@/lib/engine/commodities';
import type { ReceiptRow } from '@/lib/engine/receiptRollup';

export type PackType = 'GUNNY' | 'POLY' | 'CBOX';

export const PACK_BASE: Record<string, PackType> = {
  BRA: 'GUNNY', AAY: 'GUNNY', AAY_FRK: 'GUNNY', NPHH_FRK: 'GUNNY', PHH_FRK: 'GUNNY', PHH_BRA: 'GUNNY',
  RRA: 'GUNNY', NPHH_RRA: 'GUNNY', WHEAT: 'GUNNY', TOOR: 'GUNNY', OAP: 'GUNNY', APS: 'GUNNY',
  PB_BRA: 'GUNNY', PB_WHEAT: 'GUNNY', PB_TOOR: 'GUNNY',
  SUGAR: 'POLY', AAY_SUGAR: 'POLY', SALT_CIS: 'POLY', SALT_RFFS: 'POLY', PB_SUGAR: 'POLY',
  PALM: 'CBOX', OOTY: 'CBOX', TAN: 'CBOX', PB_PALM: 'CBOX',
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

/** Packs emptied by the month's sales: Σ floor(sales ÷ pack size) per type. */
export function packCounts(sales: Record<string, number>, types: Record<string, PackType> = PACK_BASE): Record<PackType, number> {
  const out: Record<PackType, number> = { GUNNY: 0, POLY: 0, CBOX: 0 };
  for (const [id, type] of Object.entries(types)) out[type] += bagsOf(Number(sales[id]) || 0, id);
  return out;
}
