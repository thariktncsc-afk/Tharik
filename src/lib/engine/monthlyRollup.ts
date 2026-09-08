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
 *
 * Godown receipts (receiptStore) join the walk as a third input, mirroring what
 * the Daily Entry grid now shows on screen. For any shop-day-commodity they
 * cover they REPLACE that day's keyed Receipt figure instead of adding to it —
 * the grid fills the same cell from the same source, so summing both would
 * count one delivery twice. A receipt landing on a day nobody keyed a sheet for
 * still reaches the month; without that the stock vanished from Monthly Entry
 * and the PV statement, which reads its per-commodity receipt from
 * monthlyStore.
 *
 * A commodity whose month is keyed by hand in Monthly Entry (or came in from
 * the imported workbooks) is left exactly as keyed. Those are whole-month
 * figures that already state a receipt; a godown row is not evidence the
 * clerk's number is wrong, and silently rewriting it would alter statutory
 * paperwork with nothing on screen to show for it.
 */
import { bagsOf, entryListsFor, type Commodity, type DayEntry } from '@/lib/engine/commodities';
import { receiptQtyForMonth, type ReceiptRow } from '@/lib/engine/receiptRollup';
import { isProjectedSheet } from '@/lib/engine/monthProjection';

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
/**
 * Where each published figure came from.
 *   'daily'   — accumulated from day sheets; the whole row is read-only
 *   'manual'  — keyed in Monthly Entry (or imported); the whole row is keyable
 *   'receipt' — only the Receipt came from the Receipt Register; Opening and
 *               Sales are still the clerk's to key
 *
 * 'receipt' is new. The legacy screen's meIsDerived() tests `=== 'daily'`, so
 * it reads these rows as keyable — which is what it has always done, since it
 * knows nothing about godown receipts.
 */
export type MonthlySource = 'daily' | 'manual' | 'receipt';
export type SourceBlock = { a: Record<string, MonthlySource>; b: Record<string, MonthlySource> };

type InspRec = { excess?: number; shortage?: number; transfer?: number };
type InspDay = { a?: Record<string, InspRec>; b?: Record<string, InspRec> };

const pad2 = (n: number) => String(n).padStart(2, '0');

export function dailyRollupForMonth(
  crsId: number,
  month: number,
  year: number,
  entryStore: Record<string, DayEntry>,
  inspectionStore: Record<string, InspDay>,
  receiptStore?: ReceiptRow[],
  commodityLists?: { a: Commodity[]; b: Commodity[] },
) {
  const n = new Date(year, month, 0).getDate();
  const godown = receiptQtyForMonth(receiptStore, crsId, month, year);
  // A receipt row records a commodity but not a section, so ids it introduces
  // on a day with no sheet need placing. Ids are unique across A and B.
  const secOf = new Map<string, 'a' | 'b'>();
  if (Object.keys(godown).length) {
    const lists = commodityLists ?? entryListsFor(crsId);
    for (const sec of ['a', 'b'] as const) for (const c of lists[sec]) secOf.set(c.id, sec);
  }
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
    /** The Receipt Register spoke for this commodity somewhere in the month. */
    godown: boolean;
  };
  const out: { a: Record<string, Acc>; b: Record<string, Acc> } = { a: {}, b: {} };
  let days = 0;

  for (let day = 1; day <= n; day++) {
    const ds = `${year}-${pad2(month)}-${pad2(day)}`;
    // A projected sheet is this month's own manual figures written out as a
    // day for the DSS and the date-wise sections to print. It is an output of
    // the month, never an input — read back here it would lock every row as
    // "from Daily" and, once a real sheet was keyed, count the month twice.
    const kept = entryStore[`${crsId}_${ds}`];
    const ent = isProjectedSheet(kept) ? undefined : kept;
    const ins = inspectionStore[`${crsId}_${ds}`];
    const rcp = godown[ds];
    if (!ent && !ins && !rcp) continue;
    if (ent) days++;

    for (const sec of ['a', 'b'] as const) {
      const blk = ent?.[sec] ?? {};
      const iblk = ins?.[sec] ?? {};
      const rIds = rcp ? Object.keys(rcp).filter((k) => secOf.get(k) === sec) : [];
      const ids = [...new Set([...Object.keys(blk), ...Object.keys(iblk), ...rIds])];
      for (const id of ids) {
        const r = blk[id] ?? {};
        const a = iblk[id] ?? {};
        // Godown receipt for THIS day, if the register carries one. It stands
        // in for the sheet's Receipt cell rather than adding to it — receiptQty
        // is never stored as 0, so `||` picks the register whenever it spoke.
        const g = rcp?.[id] || 0;
        const t =
          out[sec][id] ??
          (out[sec][id] = { open: null, receipt: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, days: 0, godown: false });
        t.receipt += g || (blk[id] ? Number(r.receipt) || 0 : 0);
        if (g) t.godown = true;
        if (blk[id]) {
          // A day sheet writes a row for EVERY commodity, so an all-zero row
          // must not count as "this commodity was keyed in Daily Entry".
          const hasVal =
            (Number(r.open) || 0) !== 0 ||
            (Number(r.receipt) || 0) !== 0 ||
            (Number(r.sales) || 0) !== 0 ||
            (Number(r.close) || 0) !== 0 ||
            (Number(r.amount) || 0) !== 0;
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

  const finalize = (acc: Acc, id: string): MonthlyRec & { days: number; godown: boolean } => {
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
      godown: acc.godown,
    };
  };

  type Finalized = MonthlyRec & { days: number; godown: boolean };
  const data: { a: Record<string, Finalized>; b: Record<string, Finalized> } = { a: {}, b: {} };
  for (const sec of ['a', 'b'] as const) {
    for (const [id, acc] of Object.entries(out[sec])) data[sec][id] = finalize(acc, id);
  }
  return { data, days };
}

/**
 * A hand-keyed month with the Receipt replaced by the register's total.
 *
 * Opening, Sales and C.S are left alone — they are the clerk's figures — but
 * Total and Closing have to be recomputed or the row stops adding up. Closing
 * follows Monthly Entry's own rule (total − sales − cs) rather than the daily
 * one, because that is where these values were keyed.
 *
 * The office's own bag counts for Opening and Sales are kept; the three that
 * move with the receipt are re-derived, since the stored ones describe the
 * figure that was just replaced.
 */
function withRegisterReceipt(m: MonthlyRec, receipt: number, id: string): MonthlyRec {
  const open = Number(m.open) || 0;
  const sales = Number(m.sales) || 0;
  const cs = Number(m.cs) || 0;
  const total = open + receipt + (Number(m.excess) || 0) - (Number(m.shortage) || 0) - (Number(m.transfer) || 0);
  const close = total - sales - cs;
  return {
    ...m,
    receipt,
    total,
    close,
    g_receipt: bagsOf(receipt, id),
    g_total: bagsOf(total, id),
    g_close: bagsOf(close, id),
  };
}

/**
 * A hand-keyed month with the month's inspections applied over it.
 *
 * The clerk's Opening, Receipt, Sales and C.S stay; the three adjustments are
 * REPLACED by the inspection totals — replaced, not added, because after a
 * Monthly Entry save the manual row already holds the same sums, and adding
 * would count every inspection twice. Total and Closing follow Monthly
 * Entry's own rule (total − sales − cs), and the two bag counts that move
 * with them are re-derived. Same arithmetic as rowFor() on that page, so the
 * screen and the statements agree.
 */
function withInspection(m: MonthlyRec, adj: { excess: number; shortage: number; transfer: number }, id: string): MonthlyRec {
  const open = Number(m.open) || 0;
  const receipt = Number(m.receipt) || 0;
  const sales = Number(m.sales) || 0;
  const cs = Number(m.cs) || 0;
  const total = open + receipt + adj.excess - adj.shortage - adj.transfer;
  const close = total - sales - cs;
  return {
    ...m,
    excess: adj.excess,
    shortage: adj.shortage,
    transfer: adj.transfer,
    total,
    close,
    g_total: bagsOf(total, id),
    g_close: bagsOf(close, id),
  };
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
  receiptStore?: ReceiptRow[],
): { merged: MonthlyBlock; source: SourceBlock } {
  // The database commodity master when the caller has it loaded; the
  // compiled lists otherwise (and always for the byte-parity statement path).
  const lists = commodityLists ?? entryListsFor(crsId);
  const roll = dailyRollupForMonth(crsId, month, year, entryStore, inspectionStore, receiptStore, lists);
  const merged: MonthlyBlock = { a: {}, b: {} };
  const source: SourceBlock = { a: {}, b: {} };

  for (const [sec, comms] of [['a', lists.a], ['b', lists.b]] as const) {
    for (const c of comms) {
      const d = roll.data[sec][c.id];
      const m = manual?.[sec]?.[c.id];
      // Only a keyed day sheet makes a row "from Daily". An inspection on its
      // own used to as well — the original engine's rule — which meant a shop
      // keying its month on the Monthly Entry page lost the whole row to zeros
      // the moment it recorded a shortage there. Adjustments alone now overlay
      // the manual row; it stays the clerk's to key.
      const fromDaily = !!d && d.days > 0;
      const adjOnly = !!d && !fromDaily && (d.excess !== 0 || d.shortage !== 0 || d.transfer !== 0);
      if (fromDaily) {
        // The day sheets already carry the register's figure in their Receipt
        // column — dailyRollupForMonth substituted it day by day.
        const { days: _days, godown: _godown, ...rec } = d;
        merged[sec][c.id] = rec;
        source[sec][c.id] = 'daily';
      } else if (m) {
        // A hand-keyed month. Its Opening and Sales are the clerk's and stay
        // the clerk's; only the Receipt defers to the register, and only when
        // the register actually holds a dated row for this commodity.
        let rec = d?.godown ? withRegisterReceipt(m, d.receipt, c.id) : m;
        if (adjOnly) rec = withInspection(rec, d, c.id);
        merged[sec][c.id] = rec;
        source[sec][c.id] = d?.godown ? 'receipt' : 'manual';
      } else if (d?.godown) {
        // Nothing keyed anywhere — the receipt alone carries the month.
        const { days: _days, godown: _godown, ...rec } = d;
        merged[sec][c.id] = rec;
        source[sec][c.id] = 'receipt';
      } else if (adjOnly) {
        // Nothing keyed anywhere but an inspection. Publish the adjustment so
        // the statements carry it, as a keyable row — there is no day sheet
        // to send the clerk back to.
        const { days: _days, godown: _godown, ...rec } = d;
        merged[sec][c.id] = rec;
        source[sec][c.id] = 'manual';
      }
    }
  }
  return { merged, source };
}
