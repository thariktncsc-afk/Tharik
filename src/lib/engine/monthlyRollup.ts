/**
 * Daily → Monthly accumulation — ported from 05-monthly-entry.js
 * (dailyRollupForMonth / rebuildMonthlyFromDaily) with the CRS 29 list
 * scoping from 27-crs29-entry.js.
 *
 * Rule: whatever is keyed in Daily Entry rolls up automatically into the
 * monthly figures for that CRS + month. A commodity with NO daily sheet can
 * be keyed straight into Monthly Entry — those manual values (including the
 * imported workbook months with their C.S / bag-count fields) pass through
 * untouched, and meSourceStore marks each commodity 'daily' or 'manual'.
 */
import { bagsOf, entryListsFor, type Commodity, type DayEntry } from '@/lib/engine/commodities';

export type MonthlyRec = {
  open: number;
  receipt: number;
  total: number;
  sales: number;
  close: number;
  amount: number;
  excess: number;
  shortage: number;
  transfer: number;
  g_open: number;
  g_receipt: number;
  g_total: number;
  g_sales: number;
  g_close: number;
  cs?: number;
  g_cs?: number;
};
export type MonthlyBlock = { a: Record<string, MonthlyRec>; b: Record<string, MonthlyRec> };
export type SourceBlock = { a: Record<string, 'daily' | 'manual'>; b: Record<string, 'daily' | 'manual'> };

type InspRec = { excess?: number; shortage?: number; transfer?: number };
type InspDay = { a?: Record<string, InspRec>; b?: Record<string, InspRec> };

const pad2 = (n: number) => String(n).padStart(2, '0');

export function dailyRollupForMonth(
  crsId: number,
  month: number,
  year: number,
  entryStore: Record<string, DayEntry>,
  inspectionStore: Record<string, InspDay>,
) {
  const n = new Date(year, month, 0).getDate();
  type Acc = {
    open: number | null;
    receipt: number;
    sales: number;
    close: number;
    amount: number;
    excess: number;
    shortage: number;
    transfer: number;
    days: number;
  };
  const out: { a: Record<string, Acc>; b: Record<string, Acc> } = { a: {}, b: {} };
  let days = 0;

  for (let day = 1; day <= n; day++) {
    const ds = `${year}-${pad2(month)}-${pad2(day)}`;
    const ent = entryStore[`${crsId}_${ds}`];
    const ins = inspectionStore[`${crsId}_${ds}`];
    if (!ent && !ins) continue;
    if (ent) days++;

    for (const sec of ['a', 'b'] as const) {
      const blk = ent?.[sec] ?? {};
      const iblk = ins?.[sec] ?? {};
      const ids = [...Object.keys(blk), ...Object.keys(iblk).filter((k) => !(k in blk))];
      for (const id of ids) {
        const r = blk[id] ?? {};
        const a = iblk[id] ?? {};
        const t =
          out[sec][id] ??
          (out[sec][id] = { open: null, receipt: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, days: 0 });
        if (blk[id]) {
          // A day sheet writes a row for EVERY commodity, so an all-zero row
          // must not count as "this commodity was keyed in Daily Entry".
          const hasVal =
            (Number(r.open) || 0) !== 0 ||
            (Number(r.receipt) || 0) !== 0 ||
            (Number(r.sales) || 0) !== 0 ||
            (Number(r.close) || 0) !== 0 ||
            (Number(r.amount) || 0) !== 0;
          t.receipt += Number(r.receipt) || 0;
          t.sales += Number(r.sales) || 0;
          t.amount += Number(r.amount) || 0;
          if (hasVal) {
            if (t.open === null) t.open = Number(r.open) || 0; // first real sheet's opening
            t.close = Number(r.close) || 0; // last real sheet's closing
            t.days++;
          }
        }
        t.excess += Number(a.excess) || 0;
        t.shortage += Number(a.shortage) || 0;
        t.transfer += Number(a.transfer) || 0;
      }
    }
  }

  const finalize = (acc: Acc, id: string): MonthlyRec & { days: number } => {
    const open = acc.open ?? 0;
    const total = open + acc.receipt + acc.excess - acc.shortage - acc.transfer;
    const close = total - acc.sales;
    return {
      open,
      receipt: acc.receipt,
      total,
      sales: acc.sales,
      close,
      amount: acc.amount,
      excess: acc.excess,
      shortage: acc.shortage,
      transfer: acc.transfer,
      g_open: bagsOf(open, id),
      g_receipt: bagsOf(acc.receipt, id),
      g_total: bagsOf(total, id),
      g_sales: bagsOf(acc.sales, id),
      g_close: bagsOf(close, id),
      days: acc.days,
    };
  };

  const data: { a: Record<string, MonthlyRec & { days: number }>; b: Record<string, MonthlyRec & { days: number }> } = { a: {}, b: {} };
  for (const sec of ['a', 'b'] as const) {
    for (const [id, acc] of Object.entries(out[sec])) data[sec][id] = finalize(acc, id);
  }
  return { data, days };
}

/**
 * Merge the daily roll-up with the month's manual values and return the
 * published monthly block + per-commodity source flags. Callers write the
 * result into monthlyStore/meSourceStore through the data layer.
 */
export function rebuildMonthlyFromDaily(
  crsId: number,
  month: number,
  year: number,
  entryStore: Record<string, DayEntry>,
  inspectionStore: Record<string, InspDay>,
  manual: Partial<MonthlyBlock> | undefined,
  commodityLists?: { a: Commodity[]; b: Commodity[] },
): { merged: MonthlyBlock; source: SourceBlock } {
  const roll = dailyRollupForMonth(crsId, month, year, entryStore, inspectionStore);
  // The database commodity master when the caller has it loaded; the
  // compiled lists otherwise (and always for the byte-parity statement path).
  const lists = commodityLists ?? entryListsFor(crsId);
  const merged: MonthlyBlock = { a: {}, b: {} };
  const source: SourceBlock = { a: {}, b: {} };

  for (const [sec, comms] of [['a', lists.a], ['b', lists.b]] as const) {
    for (const c of comms) {
      const d = roll.data[sec][c.id];
      if (d && (d.days > 0 || d.excess || d.shortage || d.transfer)) {
        const { days: _days, ...rec } = d;
        merged[sec][c.id] = rec;
        source[sec][c.id] = 'daily';
      } else {
        const m = manual?.[sec]?.[c.id];
        if (m) {
          merged[sec][c.id] = m;
          source[sec][c.id] = 'manual';
        }
      }
    }
  }
  return { merged, source };
}
