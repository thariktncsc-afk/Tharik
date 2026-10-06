/**
 * PV-ONLY corrections — Gunny figures the office has set for ONE shop's ONE
 * PV, printed on that PV and nowhere else (office, 2026-10-06).
 *
 * A correction is keyed by the shop and the PV's period (its first and last
 * month) and holds the PERIOD's figures as the PV prints them — Receipt,
 * Issues and Closing for the whole period, not one month's. Opening follows
 * from them (Closing − Receipt + Issues), so the row adds up:
 * Total = Opening + Receipt, Closing = Total − Issues.
 *
 * It is laid over the PV's Gunny on the Reports page (Automatic PV and Manual
 * 3-Month PV alike), so the preview, Print, Download PDF and the all-shops
 * ZIP — all the same markup — carry it. NOTHING ELSE reads this file:
 * Monthly / Daily Sales, Gunny Stock Management, the Receipt Register, the
 * DSS and every statement keep the stored figures, a 3-Month PV's month-to-
 * month chain check still runs on them, and nothing is written to the
 * database. `npm run verify:pv-gunny` §7.
 */
import type { GunnyFlow, GunnyKey } from './pvPdfParse';

type Correction = { receipt: number; issues: number; closing: number };
type Period = { month: number; year: number }[];

const ym = (m: { month: number; year: number }) => `${m.year}-${m.month}`;
const keyOf = (crsId: number, months: Period) => (months.length ? `${crsId}|${ym(months[0])}|${ym(months[months.length - 1])}` : '');

export const PV_GUNNY_CORRECTIONS: Record<string, { note: string; rows: Partial<Record<GunnyKey, Correction>> }> = {
  // CRS 9, the July – September 2026 PV (office, 2026-10-06): POLYTHENE
  // Receipt 49, Issues 38, C.B 11 (the system's 46 / 35 / 11); C.BOX 145 /
  // 145 / 0 (the system's 144 / 144 / 0). 50 KG SS GUNNY as the system has it.
  '9|2026-7|2026-9': {
    note: 'office, 2026-10-06 — CRS 9 Jul–Sep 2026 PV only',
    rows: {
      poly: { receipt: 49, issues: 38, closing: 11 },
      cbox: { receipt: 145, issues: 145, closing: 0 },
    },
  },
};

/** This PV's Gunny with its PV-only correction laid over it — a new object; `g` is untouched. */
export function pvGunnyWithCorrection(crsId: number, months: Period, g: Record<GunnyKey, GunnyFlow>): Record<GunnyKey, GunnyFlow> {
  const c = PV_GUNNY_CORRECTIONS[keyOf(crsId, months)];
  if (!c) return g;
  const out = { ...g };
  for (const [k, v] of Object.entries(c.rows) as [GunnyKey, Correction][]) {
    const opening = v.closing - v.receipt + v.issues;
    out[k] = { opening, receipt: v.receipt, total: opening + v.receipt, issues: v.issues, closing: v.closing };
  }
  return out;
}
