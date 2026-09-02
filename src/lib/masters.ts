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

export type ShopRow = { code?: string; name: string; cards?: number; taluk?: string; district?: string; active?: boolean };
export type CommodityRow = Commodity & { section: 'a' | 'b'; order: number; active: boolean; crs29Only?: boolean };

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

const bySection = (rows: CommodityRow[], sec: 'a' | 'b'): Commodity[] =>
  rows
    .filter((c) => c.section === sec && c.active !== false && !c.crs29Only)
    .sort((a, b) => a.order - b.order)
    .map(({ id, ta, en, unit, rate, free }) => ({ id, ta, en, unit, rate: Number(rate) || 0, free: !!free }));

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
  if (isCrs29(crsId)) return { a: pickIds(master, CRS29_ENTRY_A.map((c) => c.id)), b: [] };
  return { a: bySection(master, 'a'), b: bySection(master, 'b') };
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
    if (isCrs29(crsId)) return { a: pickIds(master, CRS29_STOCK.map((c) => c.id)), b: [] };
    return { a: bySection(master, 'a'), b: bySection(master, 'b') };
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
