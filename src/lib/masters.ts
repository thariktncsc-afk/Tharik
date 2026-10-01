'use client';

/**
 * Store-backed masters for the converted screens.
 *
 * Shop names and the commodity list (names, units, RATES) live in the
 * database — `__shops` and `__commodityMaster` in crs_state, seeded by
 * tools/seed-masters.mjs and edited on the CRS Shops / Commodities screens.
 * The constants in src/lib/engine/* remain only as compiled-in fallbacks for
 * the moment before the first load; once the data layer is ready the
 * database wins.
 *
 * The statement engine is the deliberate exception: its commodity lists are
 * baked verbatim from the legacy source, because its output is held
 * byte-identical to the golden snapshots. Statement figures still follow
 * rate edits, since they read the amounts the entry screens store.
 */
import { useMemo } from 'react';
import { useStore } from '@/lib/dataStore';
import { CRS29_ENTRY_A, CRS29_STOCK, DSS_A, DSS_B, isCrs29, type Commodity } from '@/lib/engine/commodities';
import { SHOPS, type Shop } from '@/lib/engine/shops';
import { inScope } from '@/lib/engine/commodityScope';

export type ShopRow = { code?: string; name: string; cards?: number; taluk?: string; district?: string; active?: boolean };
/**
 * scope / shopId (office, 2026-10-01): a row is for every shop unless it says
 * `scope: 'shop', shopId: N` — then CRS N alone sees it, at its Order.
 * Rows without a scope are All Shops (engine/commodityScope.ts).
 */
export type CommodityRow = Commodity & { section: 'a' | 'b'; order: number; active: boolean; crs29Only?: boolean; scope?: 'all' | 'shop'; shopId?: number };

/** All 30 shops in CRS order — names from the database, falling back to the compiled list. */
export function useShops(): Shop[] {
  const rows = useStore<ShopRow[]>('__shops');
  return useMemo(() => {
    if (!rows || rows.length < 30) return SHOPS;
    return SHOPS.map((s, i) => ({ id: s.id, name: rows[i]?.name || s.name }));
  }, [rows]);
}

/** The raw commodity master (all records incl. inactive), or null before load. */
export function useCommodityMaster(): CommodityRow[] | null {
  const rows = useStore<CommodityRow[]>('__commodityMaster');
  return rows && rows.length ? rows : null;
}

const plain = ({ id, ta, en, unit, rate, free }: CommodityRow): Commodity => ({ id, ta, en, unit, rate: Number(rate) || 0, free: !!free });

/** One section for one shop: the global rows + this shop's own, in Order. */
const bySection = (rows: CommodityRow[], sec: 'a' | 'b', crsId: number | null | undefined): Commodity[] =>
  rows
    .filter((c) => c.section === sec && c.active !== false && !c.crs29Only && inScope(c, crsId))
    .sort((a, b) => a.order - b.order)
    .map(plain);

/**
 * The camp's fixed list, with any commodity assigned to CRS 29 itself put in
 * at its Order — before the first camp line whose Order is higher.
 */
const withOwn = (base: Commodity[], rows: CommodityRow[], crsId: number): Commodity[] => {
  const own = rows.filter((c) => c.scope === 'shop' && Number(c.shopId) === crsId && c.active !== false && c.section === 'a').sort((a, b) => a.order - b.order);
  if (!own.length) return base;
  const orderOf = (id: string) => rows.find((c) => c.id === id)?.order ?? Number.MAX_SAFE_INTEGER;
  const out = [...base];
  for (const c of own) {
    if (out.some((x) => x.id === c.id)) continue;
    const at = out.findIndex((x) => orderOf(x.id) > c.order);
    out.splice(at === -1 ? out.length : at, 0, plain(c));
  }
  return out;
};

const pickIds = (rows: CommodityRow[], ids: string[]): Commodity[] =>
  ids
    .map((id) => rows.find((c) => c.id === id && c.active !== false))
    .filter((c): c is CommodityRow => !!c)
    .map(({ id, ta, en, unit, rate, free }) => ({ id, ta, en, unit, rate: Number(rate) || 0, free: !!free }));

/**
 * Entry-screen lists (Daily/Monthly) for one shop — the camp keys its own
 * list and has no police section. Takes the master rather than reading it, so
 * callers outside a hook (a save handler republishing several shops' months)
 * can build the list for a shop that is not the one on screen.
 */
export function commodityListsFor(master: CommodityRow[] | null, crsId: number | null | undefined): { a: Commodity[]; b: Commodity[] } {
  if (!master) return isCrs29(crsId) ? { a: CRS29_ENTRY_A, b: [] } : { a: DSS_A, b: DSS_B };
  if (isCrs29(crsId)) return { a: withOwn(pickIds(master, CRS29_ENTRY_A.map((c) => c.id)), master, 29), b: [] };
  return { a: bySection(master, 'a', crsId), b: bySection(master, 'b', crsId) };
}

/** Entry-screen lists (Daily/Monthly): the camp keys its own list, no police. */
export function useCommodityLists(crsId: number | null | undefined): { a: Commodity[]; b: Commodity[] } {
  const master = useCommodityMaster();
  return useMemo(() => commodityListsFor(master, crsId), [master, crsId]);
}

/** Dashboard/stock lists: the camp shows only its seven stocked lines. */
export function useStockLists(crsId: number | null | undefined): { a: Commodity[]; b: Commodity[] } {
  const master = useCommodityMaster();
  return useMemo(() => {
    if (!master) return isCrs29(crsId) ? { a: CRS29_STOCK, b: [] } : { a: DSS_A, b: DSS_B };
    if (isCrs29(crsId)) return { a: withOwn(pickIds(master, CRS29_STOCK.map((c) => c.id)), master, 29), b: [] };
    return { a: bySection(master, 'a', crsId), b: bySection(master, 'b', crsId) };
  }, [master, crsId]);
}

/** Not allotted: packet lines, packing materials, police (22-allotment.js). */
const ALLOT_EXCLUDE = new Set(['SALT_CIS', 'SALT_RFFS', 'OOTY', 'TAN', 'EMPTY_BOX', 'EMPTY_BAG']);

export function useAllotItems(crsId: number | null | undefined): Commodity[] {
  const lists = useStockLists(crsId);
  return useMemo(() => {
    if (isCrs29(crsId)) return lists.a; // the camp's seven, incl. kerosene
    return lists.a.filter((c) => !ALLOT_EXCLUDE.has(c.id));
  }, [lists, crsId]);
}
