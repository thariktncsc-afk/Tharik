/**
 * Who verified a shop, and when.
 *
 * The PV statement carries two fields a clerk would otherwise retype for every
 * shop: "NAME AND DESIGNATION OF THE P.V. OFFICER" and "DATE OF P.V.". One
 * officer covers a group of five or six shops, so the officer is recorded once
 * per GROUP and resolved per shop when a statement is built.
 *
 * THE DATE IS THE EXCEPTION. An officer signs one name across their group but
 * physically visits the shops on different days, and the date on the form has
 * to be the day that shop was actually verified. So the group carries a default
 * date and any shop may override it — `dateFor()` is the only thing that
 * decides which applies.
 *
 * Stored in crs_state under `__pvOfficers`, which makes the groups editable
 * without a migration. The shipped grouping below is only the seed: once a row
 * exists, the stored groups win, so an admin reshuffling shops is never
 * overwritten by a later change to this file.
 */

export type PvGroup = {
  id: string;
  label: string;
  /** CRS ids this officer covers. A shop belongs to at most one group. */
  crsIds: number[];
  officerName: string;
  designation: string;
  /** ISO date applied to every shop in the group unless overridden. */
  pvDate: string;
};

export type PvOfficerStore = {
  groups: PvGroup[];
  /** Per-shop ISO date overrides, keyed by CRS id. */
  dates: Record<string, string>;
  updatedAt?: string;
  updatedBy?: string;
};

/**
 * The Madurai region's standing grouping. Six officers, thirty shops, every
 * shop in exactly one group — `assertCoversAllShops` in the test proves that,
 * because a shop in no group prints a blank officer line and a shop in two
 * would resolve unpredictably.
 */
export const DEFAULT_GROUPS: readonly { id: string; label: string; crsIds: number[] }[] = [
  { id: 'g1', label: 'Group 1', crsIds: [1, 2, 3, 4, 5] },
  { id: 'g2', label: 'Group 2', crsIds: [6, 7, 8, 9, 12] },
  { id: 'g3', label: 'Group 3', crsIds: [10, 11, 14, 15, 30] },
  { id: 'g4', label: 'Group 4', crsIds: [13, 16, 24, 25, 26] },
  { id: 'g5', label: 'Group 5', crsIds: [18, 19, 20, 21, 22] },
  { id: 'g6', label: 'Group 6', crsIds: [17, 23, 27, 28, 29] },
] as const;

export const emptyStore = (): PvOfficerStore => ({
  groups: DEFAULT_GROUPS.map((g) => ({ ...g, crsIds: [...g.crsIds], officerName: '', designation: '', pvDate: '' })),
  dates: {},
});

/** Read the store defensively — a half-written row must not break a statement. */
export function normalise(raw: unknown): PvOfficerStore {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const o = raw as Partial<PvOfficerStore>;
  const groups = Array.isArray(o.groups) && o.groups.length
    ? o.groups.map((g, i) => ({
        id: String(g?.id ?? `g${i + 1}`),
        label: String(g?.label ?? `Group ${i + 1}`),
        crsIds: Array.isArray(g?.crsIds) ? g.crsIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
        officerName: String(g?.officerName ?? ''),
        designation: String(g?.designation ?? ''),
        pvDate: String(g?.pvDate ?? ''),
      }))
    : emptyStore().groups;
  const dates: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.dates ?? {})) if (v) dates[String(k)] = String(v);
  return { groups, dates, updatedAt: o.updatedAt, updatedBy: o.updatedBy };
}

export const groupOf = (store: PvOfficerStore, crsId: number): PvGroup | undefined =>
  store.groups.find((g) => g.crsIds.includes(crsId));

/**
 * The date printed for one shop: its own override, else its group's date.
 * An override of '' is not an override — it falls back rather than blanking
 * the field, so clearing a box cannot silently strip a date off a statement.
 */
export function dateFor(store: PvOfficerStore, crsId: number): string {
  return store.dates[String(crsId)] || groupOf(store, crsId)?.pvDate || '';
}

/** "R. Kumar, Assistant Manager" — the form wants both on one line. */
export function officerLabel(g: PvGroup | undefined): string {
  if (!g) return '';
  return [g.officerName.trim(), g.designation.trim()].filter(Boolean).join(', ');
}

/** DD-MM-YYYY, as the form is written. */
export function fmtPvDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** Everything a statement needs for one shop, ready to print. */
export function resolveForStatement(store: PvOfficerStore, crsId: number): { officer: string; date: string } {
  return { officer: officerLabel(groupOf(store, crsId)), date: fmtPvDate(dateFor(store, crsId)) };
}

/** Shops covered by no group — they would print a blank officer line. */
export function unassignedShops(store: PvOfficerStore, shopCount: number): number[] {
  const covered = new Set(store.groups.flatMap((g) => g.crsIds));
  const out: number[] = [];
  for (let i = 1; i <= shopCount; i++) if (!covered.has(i)) out.push(i);
  return out;
}

/** Shops claimed by more than one group — the resolution would be arbitrary. */
export function duplicateShops(store: PvOfficerStore): number[] {
  const seen = new Map<number, number>();
  for (const g of store.groups) for (const id of g.crsIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort((a, b) => a - b);
}
