/**
 * Brings the stored Gunny Stock copies up to the rule after a save that moved
 * the sales (office, 2026-09-30): Daily Entry, a receipt (its Gunny / Poly
 * switch), a Monthly Entry month-close, a Gunny Save's following months.
 * Receipt, Total and Closing are re-worked from the month's saved sales, and
 * every following month whose Opening is a carried copy re-carries — so
 * September's Closing is always October's Opening. Writes through the data
 * layer; the save that follows sends it with the rest, and /api/state's rule 5
 * judges it by the same function.
 */
import { crsData } from '@/lib/dataStore';
import { packTypesFor } from '@/lib/engine/gunnyPack';
import type { ReceiptRow } from '@/lib/engine/receiptRollup';
import type { MonthlyBlock } from '@/lib/engine/monthlyRollup';
import { refreshGunnyMonths, type GunnyRec } from '@/app/(app)/monthly-entry/lib';

/** Every month the given dates fall in, earliest first. */
export function refreshGunnyFor(crsId: number, dates: string[]): boolean {
  let changed = false;
  for (const ym of [...new Set(dates.map((d) => d.slice(0, 7)))].sort()) {
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) continue;
    const receipts = crsData.get<ReceiptRow[]>('receiptStore') ?? [];
    const next = refreshGunnyMonths(
      crsData.get<Record<string, Record<string, GunnyRec>>>('meGunnyStore') ?? {},
      crsId,
      m,
      y,
      crsData.get<Record<string, MonthlyBlock>>('monthlyStore') ?? {},
      (mo, yr) => packTypesFor(receipts, crsId, mo, yr),
    );
    if (next) {
      crsData.set('meGunnyStore', next);
      changed = true;
    }
  }
  return changed;
}
