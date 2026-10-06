/**
 * PV-ONLY corrections — figures the office has set for ONE shop's ONE PV,
 * printed on that PV and nowhere else (office, 2026-10-06).
 *
 * A correction is keyed by the shop and the PV's period (its first and last
 * month) and holds the PERIOD's figures as that PV prints them — Receipt,
 * Issues and Closing over the whole period, not one month's. Opening follows
 * from them (Closing − Receipt + Issues), so the row adds up:
 * Total = Opening + Receipt, Closing = Total − Issues.
 *
 * They are the MANUAL 3-Month PV's: the office read them off that PV, whose
 * Opening is the first uploaded month's and whose Receipt / Issues add up the
 * three months. The Automatic PV of the same period holds only the months
 * keyed in the system, so these figures would contradict its own (CRS 7's
 * Wheat bags 16 / 73 beside September-only kgs 715 / 1391) — it is left as
 * it is.
 *
 * Laid over the Manual PV's sheet on the Reports page, so its Preview, Print
 * and Download PDF — one markup — carry them. NOTHING ELSE reads this file:
 * Monthly / Daily Sales, Gunny Stock Management, the Receipt Register, the
 * DSS and every statement keep the stored figures, the 3-Month PV's month-to-
 * month chain check still runs on them, and nothing is written to the
 * database. `npm run verify:pv-gunny` §7.
 */
import type { GunnyFlow, GunnyKey } from './pvPdfParse';
import type { PeriodBags } from './pvQuarter';

type Correction = { receipt: number; issues: number; closing: number };
type Period = { month: number; year: number }[];

const ym = (m: { month: number; year: number }) => `${m.year}-${m.month}`;
const keyOf = (crsId: number, months: Period) => (months.length ? `${crsId}|${ym(months[0])}|${ym(months[months.length - 1])}` : '');
const flowOf = (v: Correction) => {
  const opening = v.closing - v.receipt + v.issues;
  return { opening, total: opening + v.receipt };
};

/** Gunny rows (NOS) of a PV. */
export const PV_GUNNY_CORRECTIONS: Record<string, { note: string; rows: Partial<Record<GunnyKey, Correction>> }> = {
  // CRS 9, the July – September 2026 Manual PV (office, 2026-10-06):
  // POLYTHENE 49 / 38 / 11 (the PV had 46 / 35 / 11), C.BOX 145 / 145 / 0
  // (had 144 / 144 / 0). 50 KG SS GUNNY as it is.
  '9|2026-7|2026-9': {
    note: 'office, 2026-10-06 — CRS 9 Jul–Sep 2026 PV only',
    rows: {
      poly: { receipt: 49, issues: 38, closing: 11 },
      cbox: { receipt: 145, issues: 145, closing: 0 },
    },
  },
};

/** A commodity row's BAG columns of a PV (its kgs are never touched). */
export const PV_BAG_CORRECTIONS: Record<string, { note: string; rows: Record<string, Correction> }> = {
  // CRS 7, the July – September 2026 Manual PV (office, 2026-10-06): Wheat
  // bags 16 + 73 = 89 − 68 = 21 (the PV had 16 + 74 = 90 − 69 = 21).
  '7|2026-7|2026-9': {
    note: 'office, 2026-10-06 — CRS 7 Jul–Sep 2026 PV only',
    rows: { WHEAT: { receipt: 73, issues: 68, closing: 21 } },
  },
};

/** This PV's Gunny with its PV-only correction laid over it — a new object; `g` is untouched. */
export function pvGunnyWithCorrection(crsId: number, months: Period, g: Record<GunnyKey, GunnyFlow>): Record<GunnyKey, GunnyFlow> {
  const c = PV_GUNNY_CORRECTIONS[keyOf(crsId, months)];
  if (!c) return g;
  const out = { ...g };
  for (const [k, v] of Object.entries(c.rows) as [GunnyKey, Correction][]) {
    const { opening, total } = flowOf(v);
    out[k] = { opening, receipt: v.receipt, total, issues: v.issues, closing: v.closing };
  }
  return out;
}

/**
 * This PV's commodity rows with their PV-only BAG corrections — a new map;
 * `commMap` and its rows are untouched, and only `bags` of a named row changes.
 */
export function pvCommMapWithCorrection<T extends { bags?: PeriodBags }>(crsId: number, months: Period, commMap: Record<string, T>): Record<string, T> {
  const c = PV_BAG_CORRECTIONS[keyOf(crsId, months)];
  if (!c) return commMap;
  const out = { ...commMap };
  for (const [id, v] of Object.entries(c.rows)) {
    if (!out[id]) continue;
    const { opening, total } = flowOf(v);
    out[id] = { ...out[id], bags: { open: opening, receipt: v.receipt, total, issues: v.issues, closing: v.closing } };
  }
  return out;
}
