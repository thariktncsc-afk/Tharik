/**
 * Shared types and rules for the Monthly Entry screen — ported from
 * 05-monthly-entry.js, 15-monthly-extras.js, 22-allotment.js, 40-cs-column.js.
 */
import { CRS29_STOCK, DSS_A, isCrs29, type Commodity } from '@/lib/engine/commodities';
import type { MonthlyBlock } from '@/lib/engine/monthlyRollup';

export type GunnyRec = {
  itemName?: string;
  crsId?: string;
  month?: number;
  year?: number;
  opening?: number | string;
  receipt?: number;
  total?: number;
  issues?: number | string;
  closing?: number;
  openingAuto?: boolean;
  receiptAuto?: boolean;
  receiptSrc?: string;
  receiptImported?: number;
  createdAt?: string;
  updatedAt?: string;
};
export type RemitDay = { remitDate?: string; nonCereal?: number; cereal?: string | number };
export type RemitExtra = Record<string, string | number>;
export type RemitMonth = Record<string, RemitDay | RemitExtra>;
export type CardRec = { count?: number | string };
export type SalesClose = { date: string; gunny: number; poly: number; cbox: number };

export const ME_MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const ME_GUNNY_ITEMS = [
  { id: 'ss50', label: '50 KG SS' },
  { id: 'poly', label: 'POLY' },
  { id: 'cbox', label: 'C.BOX' },
] as const;
export const ME_GUNNY_TYPE: Record<string, 'GUNNY' | 'POLY' | 'CBOX'> = { ss50: 'GUNNY', poly: 'POLY', cbox: 'CBOX' };
/** Gunny Issues flow into these Monthly Sales rows (poly bags / card+box). */
export const ME_GUNNY_TO_COMM: Record<string, string> = { poly: 'EMPTY_BAG', cbox: 'EMPTY_BOX' };

export const SC_PACK_TYPES: Record<'GUNNY' | 'POLY' | 'CBOX', Record<string, number>> = {
  GUNNY: { BRA: 50, NPHH_FRK: 50, PHH_FRK: 50, AAY_FRK: 50, AAY: 50, OAP: 50, APS: 50, TOOR: 50, PHH_BRA: 50, WHEAT: 50, RRA: 50, NPHH_RRA: 50, PB_BRA: 50, PB_WHEAT: 50, PB_TOOR: 50 },
  POLY: { SUGAR: 50, AAY_SUGAR: 50, SALT_CIS: 25, SALT_RFFS: 25, PB_SUGAR: 50 },
  CBOX: { PALM: 10, OOTY: 50, TAN: 50, PB_PALM: 10 },
};

export const ME_CARD_TYPES = [
  { id: 'rice', label: 'RICE CARD' },
  { id: 'lof_rice', label: 'LOF RICE CARD' },
  { id: 'sugar', label: 'SUGAR CARD' },
  { id: 'lof_sugar', label: 'LOF SUGAR' },
  { id: 'aay', label: 'AAY CARD' },
  { id: 'lof_aay', label: 'LOF AAY CARD' },
  { id: 'oap', label: 'OAP' },
  { id: 'police', label: 'POLICE' },
  { id: 'n_card', label: '"N" CARD' },
] as const;

/** Commodities with no gunny sub-columns on the monthly grid. */
export const NO_GUNNY = new Set(['EMPTY_BOX', 'EMPTY_BAG', 'PB_SUGAR', 'PB_WHEAT', 'PB_TOOR', 'PB_PALM', 'KERO']);

/** Not allotted: packet lines, packing materials, police ration (22-allotment). */
const ME_ALLOT_EXCLUDE = new Set(['SALT_CIS', 'SALT_RFFS', 'OOTY', 'TAN', 'EMPTY_BOX', 'EMPTY_BAG']);

/** Compiled fallback only — screens pass the database list via useAllotItems. */
export function meAllotItems(crsId: number | null): Commodity[] {
  if (isCrs29(crsId)) return CRS29_STOCK; // the camp's seven, incl. kerosene
  return DSS_A.filter((c) => !ME_ALLOT_EXCLUDE.has(c.id));
}

export function mePrevKey(crsId: number, month: number, year: number): string {
  const m = month === 1 ? 12 : month - 1;
  const y = month === 1 ? year - 1 : year;
  return `${crsId}_${m}_${y}`;
}

/** Sum of the grid's gunny-sales counts for one pack type (rule 2 fallback). */
export function monthlySalesBags(type: 'GUNNY' | 'POLY' | 'CBOX', gridGunnySales: Record<string, number>): number {
  const map = SC_PACK_TYPES[type];
  let bags = 0;
  for (const cid of Object.keys(map)) bags += Math.round(gridGunnySales[cid] ?? 0);
  return bags;
}

export function monthlyHasCounts(cards: Record<string, CardRec> | undefined): boolean {
  if (!cards) return false;
  return Object.values(cards).some((d) => d?.count !== undefined && d.count !== '' && Number(d.count) > 0);
}

export function allotHasValues(allot: Record<string, number> | undefined, items: Commodity[]): boolean {
  if (!allot) return false;
  const ids = new Set(items.map((c) => c.id));
  return Object.entries(allot).some(([id, v]) => ids.has(id) && (Number(v) || 0) > 0);
}

export type MonthCtx = { crsId: number; month: number; year: number; key: string };

export type MonthlyStores = {
  monthlyStore: Record<string, MonthlyBlock>;
  meManualStore: Record<string, Partial<MonthlyBlock>>;
  meGunnyStore: Record<string, Record<string, GunnyRec>>;
  meRemitStore: Record<string, RemitMonth>;
  meCardStore: Record<string, Record<string, CardRec>>;
  meAllotStore: Record<string, Record<string, number>>;
  meAdvanceStore: Record<string, Record<string, number>>;
  meCardConfirmed: Record<string, boolean>;
  meAllotConfirmed: Record<string, boolean>;
  salesCloseStore: Record<string, SalesClose>;
};

/**
 * Is this month's section SAVED — not merely filled?
 *
 * Card counts carry forward from last month as a draft, so a month can show
 * 500 RICE CARD having had nothing done to it. The month-close therefore asks
 * whether the person pressed Save (or No Change) FOR THIS MONTH, which is what
 * `meCardConfirmed` / `meAllotConfirmed` record, one flag per `crsId_month_year`
 * — never whether figures happen to sit in the boxes. Editing a figure clears
 * the flag again, so a review that changed something is saved before it counts.
 */
export const sectionSaved = (flags: Record<string, boolean> | undefined, key: string): boolean => flags?.[key] === true;

/**
 * Set or clear one month's saved marker, leaving every other month alone —
 * last month's saved card details and allotment are never touched by this
 * month's work. Cleared by removing the key, so an unsaved month reads the
 * same as a month that has never been saved.
 */
export function applySectionFlag(flags: Record<string, boolean>, key: string, saved: boolean): void {
  if (saved) flags[key] = true;
  else delete flags[key];
}

/**
 * What the card panel shows for a month, and whether it is only a carry
 * forward: a month with no counts of its own PREVIEWS last month's as a draft,
 * which rendering never writes. The draft is adopted by the first edit, Save
 * or No Change — until then the month has nothing saved, however filled the
 * boxes look, and `monthCloseBlock` says so.
 */
export function cardDraft(
  cards: Record<string, Record<string, CardRec>> | undefined,
  crsId: number,
  month: number,
  year: number,
): { shown: Record<string, CardRec>; carried: boolean } {
  const own = cards?.[`${crsId}_${month}_${year}`];
  const prev = cards?.[mePrevKey(crsId, month, year)];
  const carried = (!own || !Object.keys(own).length) && !!prev && Object.keys(prev).length > 0;
  if (!carried) return { shown: own ?? {}, carried: false };
  const draft: Record<string, CardRec> = {};
  for (const [id, d] of Object.entries(prev!)) draft[id] = { count: parseInt(String(d.count)) || 0 };
  return { shown: draft, carried: true };
}

export type MonthCloseBlock = { title: string; message: string; missing: ('cards' | 'allotment')[] };

/**
 * What stops a month-close, in the office's own words. `null` when both
 * sections are saved and the month may close.
 *
 * An administrator is warned rather than stopped (monthly-entry/page.tsx):
 * months imported before this rule existed have no saved marker, and a
 * correction to one of those must not be walled off.
 */
export function monthCloseBlock(cardsSaved: boolean, allotSaved: boolean): MonthCloseBlock | null {
  if (cardsSaved && allotSaved) return null;
  if (!cardsSaved && !allotSaved) {
    return {
      title: 'Monthly Details Not Saved',
      message: 'Please save Card Details and Allotment for this month before completing Monthly Sales.',
      missing: ['cards', 'allotment'],
    };
  }
  if (!cardsSaved) {
    return {
      title: 'Card Details Not Saved',
      message: 'Please review and save the Card Details for this month before completing Monthly Sales.',
      missing: ['cards'],
    };
  }
  return {
    title: 'Allotment Not Saved',
    message: 'Please review and save the Allotment for this month before completing Monthly Sales.',
    missing: ['allotment'],
  };
}
