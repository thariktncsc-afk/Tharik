/**
 * A Receipt keyed in Monthly Entry becomes a row in the Receipt Register.
 *
 * Monthly Entry is the fallback for a shop that does not key its days, and an
 * administrator using it still needs somewhere to state what the godown
 * delivered. Writing that straight onto the month would give Receipt a second
 * source of truth — the register says one thing, the month another, and the
 * statements read whichever module they happen to go through. So the month's
 * figure is pushed INTO the register instead, dated the month's last calendar
 * day, and comes back out through the path everything else already uses:
 *
 *     Monthly Entry  →  Receipt Register  →  Daily (last day)  →  Monthly
 *
 * The row this writes is marked `source: 'monthly-entry'`, which is what makes
 * it upsertable: the same shop-month always rewrites the same row rather than
 * stacking a new one on every save. It is the only receipt row the app creates
 * by itself; everything else in the register was keyed on the Receipt page.
 *
 * IT CARRIES THE RESIDUAL, NOT THE WHOLE FIGURE. A month may already hold real
 * godown receipts — dated whenever they arrived — and the Monthly Receipt is
 * the month's TOTAL, those included. Writing the total again would count the
 * real ones twice. What is written is therefore
 *
 *     residual = monthly receipt − receipts already in the register
 *
 * which keeps one invariant worth stating plainly: the register's total for a
 * shop-month equals the Receipt figure on Monthly Entry. When the register
 * already holds more than the month claims, there is no residual to write —
 * the row is removed and the caller is told, because silently writing a
 * negative receipt would mean the godown un-delivering stock.
 */
import { TOLERANCE } from '@/lib/stockGuard';
import { lastDayOfMonth } from '@/lib/engine/monthProjection';
import { type ReceiptRow } from '@/lib/engine/receiptRollup';

export const MONTHLY_RECEIPT_SOURCE = 'monthly-entry' as const;

export type MonthlyReceiptRow = ReceiptRow & {
  id: number;
  receiptNo: string;
  items: Record<string, { qty: number }>;
  savedAt: string;
  type: 'regular';
  source: typeof MONTHLY_RECEIPT_SOURCE;
};

type AnyRow = ReceiptRow & { id?: unknown; source?: unknown; items?: Record<string, unknown> };

/** Was this row written by a Monthly Entry save rather than keyed on the Receipt page? */
export const isMonthlyReceipt = (row: unknown): boolean =>
  !!row && typeof row === 'object' && (row as AnyRow).source === MONTHLY_RECEIPT_SOURCE;

/** Stable, readable reference — one per shop-month, so a clerk can place it. */
export const monthlyReceiptNo = (crsId: number, month: number, year: number) => `ME/${crsId}/${String(month).padStart(2, '0')}/${year}`;

const qtyOf = (item: unknown): number => {
  const raw = item && typeof item === 'object' ? (item as { qty?: unknown }).qty : item;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

const sameShop = (row: ReceiptRow, crsId: number) => Number(row.crsId) === Number(crsId);
const inMonth = (row: ReceiptRow, month: number, year: number) =>
  String(row.date ?? '').startsWith(`${year}-${String(month).padStart(2, '0')}`);

/**
 * What the register already holds for this shop-month per commodity, ignoring
 * the row this module owns — that one is an output and would otherwise be
 * subtracted from itself.
 */
export function keyedReceiptTotals(store: ReceiptRow[] | undefined, crsId: number, month: number, year: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of store ?? []) {
    if (!sameShop(row, crsId) || !inMonth(row, month, year) || isMonthlyReceipt(row)) continue;
    for (const [id, item] of Object.entries(row.items ?? {})) {
      const q = qtyOf(item);
      if (q) out[id] = (out[id] ?? 0) + q;
    }
  }
  return out;
}

export type MonthlyReceiptPlan = {
  /** receiptStore as it should be written. Same array when nothing changed. */
  rows: ReceiptRow[];
  /** 'created' | 'updated' | 'removed' | 'unchanged' — for the save note. */
  action: 'created' | 'updated' | 'removed' | 'unchanged';
  /** The row itself, when one survives. */
  row: MonthlyReceiptRow | null;
  /** Next free receipt id, whether or not a row was created. */
  nextId: number;
  /** Commodities the register already exceeds; their Monthly Receipt cannot be met. */
  over: { id: string; wanted: number; keyed: number }[];
};

/**
 * Fold a month's keyed Receipt figures into the register.
 *
 * `wanted` is the Receipt column of Monthly Entry, per commodity id, for the
 * rows that are keyed there — a row accumulated from day sheets must not be
 * passed: its receipts are already in the register, day by day.
 */
export function planMonthlyReceipt(
  store: ReceiptRow[] | undefined,
  crsId: number,
  month: number,
  year: number,
  wanted: Record<string, number>,
  nextId: number,
): MonthlyReceiptPlan {
  const rows = [...(store ?? [])];
  const existingAt = rows.findIndex((r) => isMonthlyReceipt(r) && sameShop(r, crsId) && inMonth(r, month, year));
  const existing = existingAt === -1 ? null : (rows[existingAt] as MonthlyReceiptRow);
  const keyed = keyedReceiptTotals(rows, crsId, month, year);

  const items: Record<string, { qty: number }> = {};
  const over: MonthlyReceiptPlan['over'] = [];
  for (const [id, raw] of Object.entries(wanted)) {
    const want = Number(raw) || 0;
    if (want <= 0) continue;
    const already = keyed[id] ?? 0;
    const residual = want - already;
    if (residual > TOLERANCE) items[id] = { qty: Number(residual.toFixed(3)) };
    else if (already - want > TOLERANCE) over.push({ id, wanted: want, keyed: already });
  }

  const unchanged: MonthlyReceiptPlan = { rows: store ?? [], action: 'unchanged', row: existing, nextId, over };

  if (!Object.keys(items).length) {
    if (!existing) return unchanged;
    rows.splice(existingAt, 1);
    return { rows, action: 'removed', row: null, nextId, over };
  }

  // Same figures again — leave the array alone so an idle Save writes nothing
  // and the audit trail stays a record of real changes.
  if (existing && JSON.stringify(existing.items) === JSON.stringify(items)) return unchanged;

  const row: MonthlyReceiptRow = {
    id: existing ? Number(existing.id) : nextId,
    crsId,
    date: lastDayOfMonth(month, year),
    receiptNo: monthlyReceiptNo(crsId, month, year),
    items,
    savedAt: new Date().toLocaleString('en-IN'),
    type: 'regular',
    source: MONTHLY_RECEIPT_SOURCE,
  };
  if (existing) rows[existingAt] = row;
  else rows.push(row);

  return { rows, action: existing ? 'updated' : 'created', row, nextId: existing ? nextId : nextId + 1, over };
}

/**
 * Take this shop-month's generated row back out of the register.
 *
 * A month is keyed by day OR by month, never both (monthProjection.ts). The
 * moment a real day sheet is saved the month follows the day sheets, and the
 * day sheets carry their own receipts — so the row standing in for the whole
 * month has to go with the projected sheet it was written alongside, or the
 * month counts that stock a second time.
 *
 * It is app-generated, so clearGuard treats removing it as bookkeeping rather
 * than a clear needing an administrator's approval — otherwise keying the
 * first day of a monthly-keyed month would stall for every shop user.
 */
export function dropMonthlyReceipt(
  store: ReceiptRow[] | undefined,
  crsId: number,
  month: number,
  year: number,
): { rows: ReceiptRow[]; dropped: boolean } {
  const rows = store ?? [];
  const kept = rows.filter((r) => !(isMonthlyReceipt(r) && sameShop(r, crsId) && inMonth(r, month, year)));
  return kept.length === rows.length ? { rows, dropped: false } : { rows: kept, dropped: true };
}
