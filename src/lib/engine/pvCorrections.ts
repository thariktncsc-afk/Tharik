/**
 * PV-ONLY corrections — figures the office has set for ONE shop's ONE PV,
 * printed on that PV and nowhere else (office, 2026-10-06).
 *
 * A correction is keyed by the shop and the PV's period (its first and last
 * month), and says which PV it belongs to:
 *   'manual' — the Manual 3-Month PV only. Figures READ OFF that PV (its
 *              Opening is the first uploaded month's, Receipt / Issues add up
 *              three months); on the Automatic PV, which holds only the months
 *              keyed in the system, they would contradict its own figures.
 *   'both'   — the Manual and the Automatic PV of that period.
 *
 * A row is corrected in one of two ways:
 *   SET  { receipt, issues, closing } — the period's figures as the PV prints
 *        them; Opening = Closing − Receipt + Issues.
 *   ADD  { add: { receipt?, issues? } } — added to the bags the PV shows
 *        (a police line shows none, i.e. 0); Opening kept.
 * Either way Total = Opening + Receipt and Closing = Total − Issues.
 *
 * Laid over the PV's sheet on the Reports page, so its Preview, Print and
 * Download PDF — one markup — carry them. NOTHING ELSE reads this file:
 * Monthly / Daily Sales, Gunny Stock Management, the Receipt Register, the
 * DSS and every statement keep the stored figures, the 3-Month PV's month-to-
 * month chain check still runs on them, and nothing is written to the
 * database. `npm run verify:pv-gunny` §7.
 */
import type { GunnyFlow, GunnyKey } from './pvPdfParse';
import type { PeriodBags } from './pvQuarter';

type SetRow = { receipt: number; issues: number; closing: number };
type AddRow = { add: { receipt?: number; issues?: number } };
type Period = { month: number; year: number }[];
type KgRow = { open: number; receipt: number; total: number; issues: number; closing: number; transfer?: number; excess?: number; shortage?: number };
export type PvKind = 'manual' | 'auto';
type Applies = 'manual' | 'both';

const ym = (m: { month: number; year: number }) => `${m.year}-${m.month}`;
const keyOf = (crsId: number, months: Period) => (months.length ? `${crsId}|${ym(months[0])}|${ym(months[months.length - 1])}` : '');
const appliesTo = (a: Applies, kind: PvKind) => a === 'both' || kind === 'manual';
const fromSet = (v: SetRow) => {
  const open = v.closing - v.receipt + v.issues;
  return { open, receipt: v.receipt, total: open + v.receipt, issues: v.issues, closing: v.closing };
};

/** Gunny rows (NOS) of a PV. */
export const PV_GUNNY_CORRECTIONS: Record<string, { note: string; applies: Applies; rows: Partial<Record<GunnyKey, SetRow>> }> = {
  // CRS 9, the July – September 2026 Manual PV (office, 2026-10-06):
  // POLYTHENE 49 / 38 / 11 (the PV had 46 / 35 / 11), C.BOX 145 / 145 / 0
  // (had 144 / 144 / 0). 50 KG SS GUNNY as it is.
  '9|2026-7|2026-9': {
    note: 'office, 2026-10-06 — CRS 9 Jul–Sep 2026 PV only',
    applies: 'manual',
    rows: {
      poly: { receipt: 49, issues: 38, closing: 11 },
      cbox: { receipt: 145, issues: 145, closing: 0 },
    },
  },
};

/** A commodity row's BAG columns of a PV (its kgs are never touched). */
export const PV_BAG_CORRECTIONS: Record<string, { note: string; applies: Applies; rows: Record<string, SetRow | AddRow> }> = {
  // CRS 7, the July – September 2026 Manual PV (office, 2026-10-06): Wheat
  // bags 16 + 73 = 89 − 68 = 21 (the PV had 16 + 74 = 90 − 69 = 21).
  '7|2026-7|2026-9': {
    note: 'office, 2026-10-06 — CRS 7 Jul–Sep 2026 PV only',
    applies: 'manual',
    rows: { WHEAT: { receipt: 73, issues: 68, closing: 21 } },
  },
  // CRS 14, the July – September 2026 Manual PV (office, 2026-10-07):
  // Wheat bags 47 + 78 = 125 − 83 = 42 (the PV had 47 + 52 = 99 − 57 = 42;
  // Receipt and Issues +26 each). Its kgs unchanged; BRA Rice untouched.
  // Manual only: the office's PV opens at July's figures (BRA 3250 kg /
  // 65 bags), the Automatic PV at September's (BRA 7917.330 kg).
  '14|2026-7|2026-9': {
    note: 'office, 2026-10-07 — CRS 14 Jul–Sep 2026 PV only',
    applies: 'manual',
    rows: { WHEAT: { add: { receipt: 26, issues: 26 } } },
  },
  // CRS 10, the July – September 2026 Manual PV (office, 2026-10-07): BRA
  // Rice (Police) Receipt 5 bags, Issues 5 bags — SET, not added to the
  // 2 / 2 Monthly Sales shows (office: "only 5") — 0 + 5 = 5 − 5 = 0. Kgs
  // unchanged (53.5 + 404 = 457.5 − 420.5 = 37).
  '10|2026-7|2026-9': {
    note: 'office, 2026-10-07 — CRS 10 Jul–Sep 2026 PV only',
    applies: 'manual',
    rows: { PB_BRA: { receipt: 5, issues: 5, closing: 0 } },
  },
  // CRS 30, the July – September 2026 PV, Manual and Automatic (office,
  // 2026-10-07; as CRS 11's): BRA Rice (Police) Receipt +1 bag, Issues +1
  // bag, so Total 1 and Balance 0. Kgs unchanged (Manual PV 25 + 110 = 135
  // − 96.5 = 38.5; the Automatic PV holds September alone, 25 + 45 − 31.5).
  '30|2026-7|2026-9': {
    note: 'office, 2026-10-07 — CRS 30 Jul–Sep 2026 PV only',
    applies: 'both',
    rows: { PB_BRA: { add: { receipt: 1, issues: 1 } } },
  },
  // CRS 11, the July – September 2026 PV, Manual and Automatic (office,
  // 2026-10-06): BRA Rice (Police) — the 54 kg received and issued counted
  // as 1 bag each: Receipt 0 → 1, Issues 0 → 1, so Total 1 and Balance 0.
  // Its kgs (2 / 54 / 56 / 54 / 2) are unchanged.
  '11|2026-7|2026-9': {
    note: 'office, 2026-10-06 — CRS 11 Jul–Sep 2026 PV only',
    applies: 'both',
    rows: { PB_BRA: { add: { receipt: 1, issues: 1 } } },
  },
};

/**
 * A commodity row's KGS columns of a PV (its bags are never touched) —
 * SET to the period's figures as the PV prints them: Receipt, Issues,
 * Closing; Opening = Closing − Receipt + Issues (transfer / excess /
 * shortage kept), Total = Opening + Receipt + transfer + excess.
 */
export const PV_KG_CORRECTIONS: Record<string, { note: string; applies: Applies; rows: Record<string, SetRow> }> = {
  // CRS 10, the July – September 2026 PV, Manual and Automatic (office,
  // 2026-10-07): OAP FRK kgs 0 + 2 = 2 − 2 = 0 (the PV had 0 + 2 = 2 − 0 = 2:
  // the 2 kg received, no sale keyed). Kgs only — its bags (0 / 2 / 2 / 2 / 0)
  // stay as Monthly Sales has them.
  '10|2026-7|2026-9': {
    note: 'office, 2026-10-07 — CRS 10 Jul–Sep 2026 PV only',
    applies: 'both',
    rows: { OAP_FRK: { receipt: 2, issues: 2, closing: 0 } },
  },
};

/**
 * Police lines whose OWN bag counts a shop's PV prints (office, 2026-10-07).
 * A police line prints no bags — every bag cell 0 — on every PV; for a shop
 * named here the listed lines print the bag counts Monthly Sales shows for
 * them (bagChain.monthBags, section b), over the PV's period, as the main
 * commodities do. Every PV of that shop, Manual and Automatic; no other shop
 * and no other police line changes. CRS 10: Police BRA (September: Receipt 2
 * bags of 143 kg, Sales 2 of 142.5 kg).
 */
export const PV_POLICE_OWN_BAGS: Record<number, string[]> = {
  10: ['PB_BRA'],
};

/**
 * This PV's rows with the shop's police lines carrying their own bags
 * (`PV_POLICE_OWN_BAGS`) — a new map. `bagsOf` is the period's bag counts of
 * the police section (pvQuarter `pvPeriodBags(…, 'b')`); a line with none
 * prints 0s.
 */
export function pvPoliceOwnBags<T extends { bags?: PeriodBags; bagsFixed?: boolean }>(
  crsId: number,
  commMap: Record<string, T>,
  bagsOf: () => Record<string, PeriodBags>,
): Record<string, T> {
  const ids = PV_POLICE_OWN_BAGS[crsId];
  if (!ids?.length) return commMap;
  const bags = bagsOf();
  const out = { ...commMap };
  for (const id of ids) {
    if (!out[id]) continue;
    out[id] = { ...out[id], bags: bags[id] ?? { open: 0, receipt: 0, total: 0, issues: 0, closing: 0 }, bagsFixed: true };
  }
  return out;
}

/** This PV's Gunny with its PV-only correction laid over it — a new object; `g` is untouched. */
export function pvGunnyWithCorrection(crsId: number, months: Period, g: Record<GunnyKey, GunnyFlow>, kind: PvKind): Record<GunnyKey, GunnyFlow> {
  const c = PV_GUNNY_CORRECTIONS[keyOf(crsId, months)];
  if (!c || !appliesTo(c.applies, kind)) return g;
  const out = { ...g };
  for (const [k, v] of Object.entries(c.rows) as [GunnyKey, SetRow][]) {
    const f = fromSet(v);
    out[k] = { opening: f.open, receipt: f.receipt, total: f.total, issues: f.issues, closing: f.closing };
  }
  return out;
}

/**
 * This PV's commodity rows with their PV-only BAG corrections — a new map;
 * `commMap` and its rows are untouched, and only `bags` of a named row
 * changes. A corrected row is marked `bagsFixed`, so a police line (which
 * otherwise prints no bags) prints the corrected ones.
 */
export function pvCommMapWithCorrection<T extends { bags?: PeriodBags; bagsFixed?: boolean }>(
  crsId: number,
  months: Period,
  commMap: Record<string, T>,
  kind: PvKind,
): Record<string, T> {
  const key = keyOf(crsId, months);
  const c = PV_BAG_CORRECTIONS[key];
  const k = PV_KG_CORRECTIONS[key];
  const useBags = !!c && appliesTo(c.applies, kind);
  const useKgs = !!k && appliesTo(k.applies, kind);
  if (!useBags && !useKgs) return commMap;
  const out = { ...commMap };
  if (useBags) {
    for (const [id, v] of Object.entries(c!.rows)) {
      if (!out[id]) continue;
      let bags: PeriodBags;
      if ('add' in v) {
        const was = out[id].bags ?? { open: 0, receipt: 0, total: 0, issues: 0, closing: 0 };
        const receipt = was.receipt + (v.add.receipt ?? 0);
        const issues = was.issues + (v.add.issues ?? 0);
        const total = was.open + receipt;
        bags = { open: was.open, receipt, total, issues, closing: total - issues };
      } else bags = fromSet(v);
      out[id] = { ...out[id], bags, bagsFixed: true };
    }
  }
  // Kgs only: the bag counts (and bagsFixed) are left exactly as they are. A
  // row the period does not carry is made, named by its code (the PV prints
  // the master's name for it).
  if (useKgs) {
    for (const [id, v] of Object.entries(k!.rows)) {
      const was = (out[id] ?? { name: id, unit: 'KG', open: 0, receipt: 0, total: 0, issues: 0, closing: 0, amount: 0, free: true }) as T & KgRow;
      const tr = (Number(was.transfer) || 0) + (Number(was.excess) || 0) - (Number(was.shortage) || 0);
      const open = v.closing - v.receipt - tr + v.issues;
      out[id] = { ...was, open, receipt: v.receipt, total: open + v.receipt + (Number(was.transfer) || 0) + (Number(was.excess) || 0), issues: v.issues, closing: v.closing } as T;
    }
  }
  return out;
}
