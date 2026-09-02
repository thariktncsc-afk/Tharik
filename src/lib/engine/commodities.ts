/**
 * Commodity masters for the converted screens — ported from the engine
 * (DSS_A / DSS_B in 03-daily-entry.js, the camp's list in 27-crs29-entry.js).
 *
 * CRS 29 (Refugee Camp) stocks seven ration commodities, has no police
 * section, and keeps Poly/C.Box only as packing counts. The legacy engine
 * enforced that by temporarily swapping the global arrays around each call;
 * here callers just ask for the right lists via listsFor()/stockListsFor().
 */
export type Commodity = {
  id: string;
  ta: string;
  en: string;
  unit: string;
  rate: number;
  free: boolean;
};

export const DSS_A: Commodity[] = [
  { id: 'BRA', ta: 'புழுங்கல் அரிசி', en: 'BRA Rice', unit: 'KG', rate: 0, free: true },
  { id: 'NPHH_FRK', ta: 'NPHH FRK அரிசி', en: 'NPHH FRK Rice', unit: 'KG', rate: 0, free: true },
  { id: 'PHH_FRK', ta: 'PHH FRK அரிசி', en: 'PHH FRK Rice', unit: 'KG', rate: 0, free: true },
  { id: 'PHH_BRA', ta: 'PHH BRA அரிசி', en: 'PHH BRA Rice', unit: 'KG', rate: 0, free: true },
  { id: 'AAY_FRK', ta: 'AAY FRK அரிசி', en: 'AAY FRK Rice', unit: 'KG', rate: 0, free: true },
  { id: 'AAY', ta: 'AAY அரிசி', en: 'AAY Rice', unit: 'KG', rate: 0, free: true },
  { id: 'RRA', ta: 'பச்சை அரிசி (RRA)', en: 'RRA Rice', unit: 'KG', rate: 0, free: true },
  { id: 'NPHH_RRA', ta: 'NPHH FRK RRA அரிசி', en: 'NPHH FRK RRA Rice', unit: 'KG', rate: 0, free: true },
  { id: 'OAP', ta: 'OAP அரிசி', en: 'OAP Rice', unit: 'KG', rate: 0, free: true },
  { id: 'APS', ta: 'APS அரிசி', en: 'APS Rice', unit: 'KG', rate: 0, free: true },
  { id: 'WHEAT', ta: 'கோதுமை', en: 'Wheat', unit: 'KG', rate: 0, free: true },
  { id: 'SUGAR', ta: 'சீனி', en: 'Sugar', unit: 'KG', rate: 25.0, free: false },
  { id: 'AAY_SUGAR', ta: 'AAY சீனி', en: 'Sugar (AAY)', unit: 'KG', rate: 13.5, free: false },
  { id: 'TOOR', ta: 'துவரம் பருப்பு', en: 'Toor Dal', unit: 'KG', rate: 30.0, free: false },
  { id: 'PALM', ta: 'பாம் ஆயில்', en: 'Palm Oil', unit: 'LTR', rate: 25.0, free: false },
  { id: 'SALT_CIS', ta: 'உப்பு (CIS)', en: 'Salt (CIS)', unit: 'PKT', rate: 12.0, free: false },
  { id: 'SALT_RFFS', ta: 'உப்பு (RFFS)', en: 'Salt (RFFS)', unit: 'PKT', rate: 12.0, free: false },
  { id: 'OOTY', ta: 'OOTY', en: 'OOTY', unit: 'PKT', rate: 25.0, free: false },
  { id: 'TAN', ta: 'TAN', en: 'TAN', unit: 'PKT', rate: 25.0, free: false },
  { id: 'EMPTY_BOX', ta: 'காலி அட்டை+பெட்டி', en: 'Empty Card+Box', unit: 'NOS', rate: 0.6, free: false },
  { id: 'EMPTY_BAG', ta: 'காலி பாலித்தீன் பை', en: 'Empty Polythene Bag', unit: 'NOS', rate: 2.5, free: false },
];

export const DSS_B: Commodity[] = [
  { id: 'PB_BRA', ta: 'புழுங்கல் அரிசி', en: 'BRA Rice (Police)', unit: 'KG', rate: 0, free: true },
  { id: 'PB_SUGAR', ta: 'சீனி', en: 'Sugar (Police)', unit: 'KG', rate: 12.5, free: false },
  { id: 'PB_WHEAT', ta: 'கோதுமை', en: 'Wheat (Police)', unit: 'KG', rate: 0, free: true },
  { id: 'PB_TOOR', ta: 'துவரம் பருப்பு', en: 'Toor Dal (Police)', unit: 'KG', rate: 15.0, free: false },
  { id: 'PB_PALM', ta: 'பாம் ஆயில்', en: 'Palm Oil (Police)', unit: 'LTR', rate: 12.5, free: false },
];

export const CRS29_KERO: Commodity = { id: 'KERO', ta: 'மண்ணெண்ணெய்', en: 'Kerosene', unit: 'LTR', rate: 15.6, free: false };

const byId = new Map(DSS_A.map((c) => [c.id, c]));

/** The camp's stocked commodities — its ration lines plus kerosene. */
export const CRS29_STOCK: Commodity[] = [
  ...(['BRA', 'RRA', 'SUGAR', 'WHEAT', 'TOOR', 'PALM'].map((id) => byId.get(id)!) as Commodity[]),
  CRS29_KERO,
];

export const isCrs29 = (crsId: number | null | undefined) => Number(crsId) === 29;

/** Bag divisors (kgs per bag) — BAG_DIV in 03-daily-entry.js. */
const BAG_DIV: Record<string, number> = { PALM: 10, SALT_CIS: 25, SALT_RFFS: 25, OOTY: 50, TAN: 50, PB_PALM: 10 };
export const bagDiv = (id: string) => BAG_DIV[id] ?? 50;
export const bagsOf = (kgs: number, id: string) => (kgs > 0 ? Math.floor(kgs / bagDiv(id)) : 0);

/** The camp's ENTRY list — its stocked lines plus the two paid packing lines. */
export const CRS29_ENTRY_A: Commodity[] = [
  ...CRS29_STOCK,
  ...(['EMPTY_BAG', 'EMPTY_BOX'].map((id) => byId.get(id)!) as Commodity[]),
];

/** Entry-screen lists for a shop: the camp keys its own list and no police. */
export function entryListsFor(crsId: number | null | undefined): { a: Commodity[]; b: Commodity[] } {
  return isCrs29(crsId) ? { a: CRS29_ENTRY_A, b: [] } : { a: DSS_A, b: DSS_B };
}

/** Stock/dashboard lists for a shop: the camp gets its seven and no police. */
export function stockListsFor(crsId: number | null | undefined): { a: Commodity[]; b: Commodity[] } {
  return isCrs29(crsId) ? { a: CRS29_STOCK, b: [] } : { a: DSS_A, b: DSS_B };
}

export type EntryRecord = { open?: number; receipt?: number; sales?: number; close?: number; amount?: number };
export type DayEntry = { a?: Record<string, EntryRecord>; b?: Record<string, EntryRecord> };

/**
 * A shop's day entry, scoped the way its dashboard counts: for CRS 29 only
 * the stocked commodities' section-A records survive (packing counts and the
 * police side drop out of kilo totals).
 */
export function dashboardEntryView(crsId: number | null | undefined, entry: DayEntry | undefined): DayEntry | undefined {
  if (!entry || !isCrs29(crsId)) return entry;
  const keep = new Set(CRS29_STOCK.map((c) => c.id));
  const a: Record<string, EntryRecord> = {};
  for (const [id, rec] of Object.entries(entry.a ?? {})) if (keep.has(id)) a[id] = rec;
  return { a, b: {} };
}
