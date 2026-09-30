/**
 * Shared types and rules for the Monthly Entry screen — ported from
 * 05-monthly-entry.js, 15-monthly-extras.js, 22-allotment.js, 40-cs-column.js.
 */
import { CRS29_STOCK, DSS_A, isCrs29, type Commodity } from '@/lib/engine/commodities';
export { SALES_ONLY } from '@/lib/engine/commodities';
import type { MonthlyBlock } from '@/lib/engine/monthlyRollup';
import { dmy } from '@/lib/dateFormat';
import { PACK_BASE, monthSalesBags, packCounts, type PackType } from '@/lib/engine/gunnyPack';

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
  /** Legacy: a Receipt typed before 2026-09-30 (the POS / workbook figure). No longer read. */
  receiptImported?: number;
  /**
   * A Receipt an ADMINISTRATOR typed into the Gunny table (office, 2026-09-30):
   * it wins over Monthly Sales' figure for that month until it is cleared.
   * Only a figure typed from that date counts — the legacy receiptImported
   * (CRS 5's 236 / 23) stays unread.
   */
  receiptTyped?: number | '';
  createdAt?: string;
  updatedAt?: string;
};
export type RemitDay = { remitDate?: string; nonCereal?: number; cereal?: string | number };
export type RemitExtra = Record<string, string | number>;
export type RemitMonth = Record<string, RemitDay | RemitExtra>;
export type CardRec = { count?: number | string };
export type SalesClose = { date: string; gunny: number; poly: number; cbox: number };

/** One Gunny Stock row as the screen shows it — see gunnyRowFor. */
export type GunnyRow = {
  rec: GunnyRec;
  opening: number;
  openingVal: string;
  openingAuto: boolean;
  rc: { val: number; src: string; imported: boolean };
  /** What Monthly Sales says, whatever was typed — shown beside a typed Receipt. */
  rcAuto: number;
  issues: number | '';
  /** True when Issues is the month's own C.Box / Poly sales rather than a keyed figure. */
  issuesAuto: boolean;
  total: number;
  closing: number;
};

/**
 * One Gunny Stock row, worked out exactly as the Gunny Stock screen shows it.
 * The screen and the 3-month PV both call this, so the PV's September Gunny
 * cannot differ from what the office sees on that screen.
 *
 *   Opening  this month's own figure, else last month's Closing carried. A
 *            stored copy of the carry (openingAuto) follows last month's
 *            Closing, so a change there reaches this month (office,
 *            2026-09-30: CB → next month's OB, always).
 *   Receipt  a Receipt an administrator typed (receiptTyped, 2026-09-30),
 *            else the sum of the bag counts MONTHLY SALES shows, by pack —
 *            engine/gunnyPack.ts: each commodity's sales ÷ its pack size,
 *            into the pack its type (and, for Wheat / RRA / NPHH FRK RRA, the
 *            month's Receipt-page switch) says. Monthly Sales is the only
 *            source (office, 2026-09-30): not Sales Close, and not a Receipt
 *            typed here — `receiptImported` is no longer read, by anyone.
 *   Issues   typed — by the shop or an administrator (office, 2026-09-30).
 *            Left blank, POLY and C.BOX show the month's Empty Polythene
 *            Bag / Empty Card+Box sales; 50 KG SS shows nothing.
 *   Total    Opening + Receipt;   Closing = Total − Issues
 */
export function gunnyRowFor(
  id: string,
  month: Record<string, GunnyRec>,
  prevMonth: Record<string, GunnyRec>,
  salesClose: SalesClose | undefined,
  gridGunnySales: Record<string, number>,
  /** The month's sales per commodity id — Issues for POLY / C.BOX, and the Receipt where no bag count is given. */
  packSales?: Record<string, number>,
  /** The month's pack types (packTypesFor — the Receipt page's switch); the base types when not given. */
  packTypes?: Record<string, PackType>,
): GunnyRow {
  const rec = month[id] ?? {};
  const prevClosing = prevMonth[id]?.closing;
  // A stored copy of the carry is not the office's own Opening: it follows
  // last month's Closing, so the carry can never go stale.
  const carriedCopy = !!rec.openingAuto && prevClosing !== undefined && prevClosing !== null;
  const hasOwnOpening = rec.opening !== undefined && rec.opening !== '' && !carriedCopy;
  const openingAuto = !hasOwnOpening && prevClosing !== undefined ? true : !!rec.openingAuto && hasOwnOpening;
  const opening = hasOwnOpening ? Number(rec.opening) || 0 : prevClosing !== undefined ? Number(prevClosing) || 0 : 0;
  const openingVal = hasOwnOpening ? String(rec.opening) : prevClosing !== undefined ? String(prevClosing) : '';
  // The Receipt is Monthly Sales' own bag counts, summed by pack: the grid's
  // figures where the caller has them (gridGunnySales), else sales ÷ pack size
  // — unless an administrator typed one (receiptTyped), which wins until it is
  // cleared (office, 2026-09-30).
  const type = ME_GUNNY_TYPE[id];
  const rcAuto = packCounts(packSales ?? {}, packTypes ?? PACK_BASE, gridGunnySales)[type];
  const typed = rec.receiptTyped !== undefined && rec.receiptTyped !== null && String(rec.receiptTyped) !== '' && Number.isFinite(Number(rec.receiptTyped));
  const rc: GunnyRow['rc'] = typed
    ? { val: Number(rec.receiptTyped), src: `Typed by an administrator — Monthly Sales says ${rcAuto}. Clear the box to go back to it.`, imported: true }
    : { val: rcAuto, src: `From Monthly Sales — the ${PACK_SRC[type]} it shows for this month`, imported: false };
  // Issues: a keyed figure (an administrator's correction) wins; otherwise
  // POLY and C.BOX take the month's own sales of those bags, which is the one
  // place they are counted. The deduction therefore happens once, here, from
  // the figure the shop keyed on the sales grid.
  const keyed = rec.issues !== undefined && rec.issues !== '' ? Number(rec.issues) : null;
  const commId = ME_GUNNY_TO_COMM[id];
  const derived = commId && packSales ? Math.round((Number(packSales[commId]) || 0) * 1000) / 1000 : null;
  const issuesAuto = keyed === null && derived !== null;
  void salesClose; // Sales Close no longer sets the Receipt (office, 2026-09-30)
  const issues: number | '' = keyed !== null ? keyed : derived !== null ? derived : '';
  const total = opening + rc.val;
  const closing = total - (Number(issues) || 0);
  return { rec, opening, openingVal, openingAuto, rc, rcAuto, issues, issuesAuto, total, closing };
}

/**
 * What stops a Gunny Save: a keyed Opening, Receipt or Issues that is not a
 * number of 0 or more (`errors` — refused), and a Closing below 0 (`deficits`
 * — the table already shows it red; the Save asks before storing it).
 */
export function gunnySaveProblems(
  own: Record<string, GunnyRec>,
  prev: Record<string, GunnyRec>,
  salesClose: SalesClose | undefined,
  gridGunnySales: Record<string, number>,
  packSales: Record<string, number>,
  packTypes?: Record<string, PackType>,
): { errors: string[]; deficits: string[] } {
  const errors: string[] = [];
  const deficits: string[] = [];
  const bad = (v: unknown) => v !== undefined && v !== '' && !(Number.isFinite(Number(v)) && Number(v) >= 0);
  for (const item of ME_GUNNY_ITEMS) {
    const cur = own[item.id] ?? {};
    if (bad(cur.opening)) errors.push(`${item.label}: Opening must be a number, 0 or more.`);
    if (bad(cur.receiptTyped)) errors.push(`${item.label}: Receipt must be a number, 0 or more.`);
    if (bad(cur.issues)) errors.push(`${item.label}: Issues must be a number, 0 or more.`);
    const r = gunnyRowFor(item.id, own, prev, salesClose, gridGunnySales, packSales, packTypes);
    if (r.closing < 0) deficits.push(`${item.label}: Issues ${r.issues} exceed Total ${r.total} (Closing ${r.closing})`);
  }
  return { errors, deficits };
}

/**
 * The month's Gunny records as they are STORED — written by the month-close
 * and by Gunny Stock Management's own Save (office, 2026-09-29), one function
 * so the two can never store different figures. Each item keeps what was
 * keyed (Opening where the office set one, 50 KG SS Issues, an administrator's
 * Receipt override) and takes the derived copies the table has always kept:
 * the Opening carried from last month where none is its own, Receipt, Total
 * and Closing — next month opens at this Closing. POLY and C.BOX's automatic
 * Issues are deliberately NOT stored: a stored figure reads as the office's
 * own and would stop following the sales. Exactly what stockGuard rule 5
 * expects from a shop user.
 */
export function gunnyMonthRecords(
  own: Record<string, GunnyRec>,
  prev: Record<string, GunnyRec>,
  ctx: MonthCtx,
  salesClose: SalesClose | undefined,
  gridGunnySales: Record<string, number>,
  packSales: Record<string, number>,
  now = new Date().toISOString(),
  packTypes?: Record<string, PackType>,
): Record<string, GunnyRec> {
  const next = { ...own };
  for (const item of ME_GUNNY_ITEMS) {
    const r = gunnyRowFor(item.id, own, prev, salesClose, gridGunnySales, packSales, packTypes);
    const cur = next[item.id] ?? {};
    // A stored copy of the carry is re-carried, never kept as the office's own.
    const ownOpening = cur.opening !== undefined && cur.opening !== '' && !r.openingAuto;
    next[item.id] = {
      itemName: cur.itemName ?? item.label,
      crsId: String(ctx.crsId),
      month: ctx.month,
      year: ctx.year,
      ...cur,
      opening: ownOpening ? cur.opening : r.openingVal !== '' ? Number(r.openingVal) : undefined,
      openingAuto: ownOpening ? cur.openingAuto : r.openingAuto,
      receipt: r.rc.val,
      total: r.total,
      closing: r.closing,
      updatedAt: now,
    };
  }
  return next;
}

export const ME_MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const ME_GUNNY_ITEMS = [
  { id: 'ss50', label: '50 KG SS' },
  { id: 'poly', label: 'POLY' },
  { id: 'cbox', label: 'C.BOX' },
] as const;
export const ME_GUNNY_TYPE: Record<string, 'GUNNY' | 'POLY' | 'CBOX'> = { ss50: 'GUNNY', poly: 'POLY', cbox: 'CBOX' };
const PACK_SRC: Record<PackType, string> = { GUNNY: 'sacks ÷50', POLY: 'poly ÷50 / salt ÷25', CBOX: 'boxes: palm oil ÷10, tea ÷50' };
/** Gunny Issues flow into these Monthly Sales rows (poly bags / card+box). */
export const ME_GUNNY_TO_COMM: Record<string, string> = { poly: 'EMPTY_BAG', cbox: 'EMPTY_BOX' };

/** The base pack of every commodity, grouped (engine/gunnyPack.ts PACK_BASE is the rule). */
export const SC_PACK_TYPES: Record<'GUNNY' | 'POLY' | 'CBOX', Record<string, number>> = { GUNNY: {}, POLY: {}, CBOX: {} };
for (const [id, t] of Object.entries(PACK_BASE)) SC_PACK_TYPES[t][id] = 1;

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

/**
 * What stops Monthly Remittance's Save (office, 2026-09-29): the hand-keyed
 * rows only — the days with no deposit on a day sheet, and the three extra
 * rows. A day sheet's own deposits were checked when they were keyed and are
 * not re-judged here. Daily Entry's rule, row by row: an amount must be a
 * number of 0 or more, an amount above zero needs its Remittance Date, and a
 * Remittance Date needs an amount ("leave the date empty if no deposit was
 * made that day"). A row with neither is simply an empty day.
 */
export function remitMonthProblems(
  month: RemitMonth,
  depositDays: Set<number>,
  ctx: Pick<MonthCtx, 'month' | 'year'>,
): string[] {
  const out: string[] = [];
  const val = (v: unknown): number | null | 'bad' => {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 'bad';
  };
  const judge = (label: string, nc: unknown, ce: unknown, date: unknown) => {
    const a = val(nc);
    const b = val(ce);
    if (a === 'bad') out.push(`${label}: the Non-Cereal amount must be a number, 0 or more.`);
    if (b === 'bad') out.push(`${label}: the Cereal amount must be a number, 0 or more.`);
    if (a === 'bad' || b === 'bad') return;
    const amount = (a ?? 0) + (b ?? 0);
    const hasDate = typeof date === 'string' && date.trim() !== '';
    if (amount > 0 && !hasDate) out.push(`${label}: Please select the Remittance Date.`);
    if (!(amount > 0) && hasDate) out.push(`${label}: Please enter the Remittance Amount (or clear the date).`);
  };
  const days = new Date(ctx.year, ctx.month, 0).getDate();
  for (let day = 1; day <= days; day++) {
    if (depositDays.has(day)) continue;
    const r = (month[day] ?? {}) as RemitDay;
    judge(`${String(day).padStart(2, '0')}-${String(ctx.month).padStart(2, '0')}-${ctx.year}`, r.nonCereal, r.cereal, r.remitDate);
  }
  const ex = (month['extra'] ?? {}) as RemitExtra;
  ([1, 2, 3] as const).forEach((n) => {
    const label = n === 1 ? 'Poly & C.Box Amount' : String(ex[`e${n}label`] ?? '').trim() || `Extra row ${n}`;
    judge(label, ex[`e${n}nc`], ex[`e${n}ce`], ex[`e${n}date`]);
  });
  return out;
}

/**
 * After a save that moves the month's SALES (Daily Entry, a receipt's
 * Gunny / Poly switch, a Monthly Entry month-close), the month's stored Gunny
 * copies — Receipt, Total, Closing — are brought up to the rule, and so is
 * every following month whose Opening is a carried copy, because next month
 * opens at this Closing (office, 2026-09-30). Keyed figures stay: Opening an
 * administrator set, Issues, an administrator's Receipt. A month with no
 * sales and no Gunny record is left alone. Returns the new meGunnyStore, or
 * null when nothing changed.
 */
export function refreshGunnyMonths(
  gunnyStore: Record<string, Record<string, GunnyRec>>,
  crsId: number,
  month: number,
  year: number,
  monthlyStore: Record<string, Partial<MonthlyBlock> | undefined>,
  typesFor: (month: number, year: number) => Record<string, PackType>,
): Record<string, Record<string, GunnyRec>> | null {
  const salesOf = (key: string) => {
    const out: Record<string, number> = {};
    const blk = monthlyStore[key];
    for (const sec of ['a', 'b'] as const) for (const [id, r] of Object.entries(blk?.[sec] ?? {})) out[id] = Number((r as { sales?: unknown })?.sales) || 0;
    return out;
  };
  const figures = (m: Record<string, GunnyRec> | undefined) =>
    JSON.stringify(ME_GUNNY_ITEMS.map((i) => { const { updatedAt: _u, ...rest } = m?.[i.id] ?? {}; return rest; }));
  const next = { ...gunnyStore };
  let changed = false;
  let m = month, y = year;
  for (let step = 0; step < 24; step++) {
    const key = `${crsId}_${m}_${y}`;
    const own = next[key];
    const sales = salesOf(key);
    if (step === 0 ? !own && !Object.values(sales).some(Boolean) : !own) break;
    const rec = gunnyMonthRecords(own ?? {}, next[mePrevKey(crsId, m, y)] ?? {}, { crsId, month: m, year: y, key }, undefined, monthSalesBags(monthlyStore[key]), sales, undefined, typesFor(m, y));
    if (figures(rec) !== figures(own)) {
      next[key] = rec;
      changed = true;
    } else if (step > 0) break; // this month already agrees, so the ones after it do too
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
  return changed ? next : null;
}
