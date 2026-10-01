/**
 * Changing a saved receipt's DATE (office, 2026-10-01) — an administrator's
 * correction on the Receipt Register, for a receipt saved under the wrong
 * date (CRS 23's R/2026/082, 23-09-2026).
 *
 * - The receipt is moved IN PLACE: same id, same Receipt No., same type and
 *   quantities — only `date` changes. Never a delete and a re-add, so there
 *   is no duplicate and nothing to approve.
 * - Everything downstream follows because it all reads the register by date:
 *   the Receipt page republishes the OLD date's month and the NEW date's
 *   month (resyncReceiptMonth — day sheets, a hand-keyed month's copy, the
 *   projection) and rebuilds the stock chain from each date (rechain), then
 *   Gunny Stock; the DSS, COLL and the statements read the register itself.
 * - Administrators only — enforced in /api/state (`receiptDateMoves`), the
 *   screen only hides the button from shop staff.
 * - The activity log names it "Receipt Date Changed" (activityLog/core.ts).
 */
import { parseDmy } from '@/lib/dateFormat';

type Loose = Record<string, unknown>;

export type ReceiptDateMove = { id: string; crsId: number | null; receiptNo: string; from: string; to: string };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD (31-02 is not one). */
export function isIsoDate(v: string): boolean {
  const m = ISO.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Why a receipt cannot move to `to` — or null when it can. `today` is YYYY-MM-DD. */
export function receiptDateProblem(rec: { date?: unknown; source?: unknown } | undefined, to: string, today: string): string | null {
  if (!rec) return 'This receipt is no longer in the register — reload and try again.';
  if (rec.source === 'monthly-entry') return 'This row is Monthly Entry\'s own month total — change it on Monthly Entry.';
  if (!to || !isIsoDate(to)) return 'Enter a valid date (DD-MM-YYYY).';
  if (to > today) return 'A receipt cannot be dated after today.';
  if (to === rec.date) return 'That is already the receipt\'s date.';
  return null;
}

/** The register with receipt `id` moved to `to` — the same row, only its date changed. */
export function moveReceiptDate<T extends { id: unknown; date: string }>(register: T[], id: unknown, to: string): T[] {
  return register.map((r) => (String(r.id) === String(id) ? { ...r, date: to } : r));
}

/** Saved receipts (matched by id) whose date differs between two registers. */
export function receiptDateMoves(before: unknown, after: unknown): ReceiptDateMove[] {
  const index = (v: unknown) => {
    const m = new Map<string, Loose>();
    if (Array.isArray(v)) for (const r of v) if (r && typeof r === 'object' && (r as Loose).id != null) m.set(String((r as Loose).id), r as Loose);
    return m;
  };
  const b = index(before);
  const out: ReceiptDateMove[] = [];
  for (const [id, y] of index(after)) {
    const x = b.get(id);
    if (!x || String(x.date ?? '') === String(y.date ?? '')) continue;
    out.push({ id, crsId: Number(y.crsId ?? x.crsId) || null, receiptNo: String(y.receiptNo ?? x.receiptNo ?? id), from: String(x.date ?? ''), to: String(y.date ?? '') });
  }
  return out;
}

/** DD-MM-YYYY typed or picked → YYYY-MM-DD (the DateField already gives ISO; kept for a typed value). */
export const toIso = (v: string) => (ISO.test(v) ? v : parseDmy(v) ?? '');
