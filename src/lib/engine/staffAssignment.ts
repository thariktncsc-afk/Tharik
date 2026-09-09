/**
 * Who holds which post at which shop — the rules behind removing, transferring
 * and replacing a Bill Clerk or Packer.
 *
 * THE ASSIGNMENT IS `users.crs_id` + `users.role`, and nothing else. That was
 * settled by 39-staff-roles.js: the statement builders resolve a shop's staff
 * through getUsersForCRS(), which reads the users table, and CRS_MASTER keeps
 * only what it is genuinely the authority on — shop code, COLL and police
 * flags, usage status. So moving someone between shops is one column, and the
 * Dashboard, the statements, the shop cards and the login popup all follow
 * without being told.
 *
 * Two things do NOT follow on their own, and they are why this module exists:
 *
 *   1. THE SHEET'S OWN bc/packer FIELDS. getUsersForCRS falls back to
 *      CRS_MASTER when a shop has no active accounts at all — the "never been
 *      set up" case. Remove the last person from a shop and that fallback
 *      would reprint the very name that was just removed, on statutory
 *      paperwork. So the sheet's slot is emptied alongside, and only when it
 *      still names the person leaving: a slot naming somebody else is the
 *      office's own record and is not ours to clear.
 *
 *   2. THE SHOP-SCOPED USERNAME. A shop's staff sign in as `crs24`, and the
 *      username is deliberately not unique — it is how the two-step login
 *      finds the people at a shop. Left alone on a transfer, the old shop's
 *      login popup would go on offering someone who no longer works there.
 *      A username that is a person's own name is theirs and travels with them.
 *
 * Pure functions, no imports: tools/verify-staff-assignment.mjs runs them.
 */

export type StaffRole = 'BC' | 'Packer';
export const STAFF_ROLES: readonly StaffRole[] = ['BC', 'Packer'];

/** The fields of a user this module needs; the roster carries more. */
export type Assignee = {
  id: number;
  fullName: string;
  username: string;
  phone: string;
  role: string;
  crsId: number | null;
  active: boolean;
};

/** One row of the office's sheet (__crsMaster). */
export type MasterRec = {
  id: number;
  bc: string;
  bcMobile: string;
  packer: string;
  packerMobile: string;
  [k: string]: unknown;
};

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
/** `crs24` — the username a shop's staff share. Case-insensitive; nothing else counts. */
const SHOP_USERNAME = /^crs(\d+)$/i;

/** The active holder of one post at one shop, or null when the post is vacant. */
export function occupant<T extends Assignee>(users: T[], crsId: number, role: StaffRole): T | null {
  return users.find((u) => u.crsId === crsId && u.role === role && u.active !== false) ?? null;
}

/** Which of BC / Packer nobody is filling at this shop. */
export function vacantRoles(users: Assignee[], crsId: number): StaffRole[] {
  return STAFF_ROLES.filter((r) => !occupant(users, crsId, r));
}

/**
 * The username this person should sign in with after moving shops.
 *
 * Returns null when it should not change — which is the case for anything that
 * is not the old shop's own `crs<N>`. Somebody whose username is their name
 * keeps it; so does an account already keyed to the destination.
 */
export function usernameOnTransfer(username: string, fromCrsId: number | null, toCrsId: number): string | null {
  const m = SHOP_USERNAME.exec(String(username ?? '').trim());
  if (!m) return null;
  if (fromCrsId !== null && Number(m[1]) !== Number(fromCrsId)) return null; // not this shop's
  const next = `crs${toCrsId}`;
  return next === String(username).trim() ? null : next;
}

/** Is this a shop-scoped username rather than a person's own? */
export const isShopUsername = (username: string) => SHOP_USERNAME.test(String(username ?? '').trim());

const slotFields = (role: StaffRole) => (role === 'BC' ? (['bc', 'bcMobile'] as const) : (['packer', 'packerMobile'] as const));

/**
 * Record a person in the sheet's slot for one shop and post.
 *
 * Returns a NEW array, or null when nothing needed changing — so an idle save
 * writes nothing and the audit trail stays a record of real changes.
 */
export function withMasterSlot(
  master: MasterRec[] | undefined,
  crsId: number,
  role: StaffRole,
  name: string,
  mobile: string,
): MasterRec[] | null {
  if (!Array.isArray(master)) return null;
  const [nameKey, mobileKey] = slotFields(role);
  const at = master.findIndex((m) => Number(m?.id) === Number(crsId));
  if (at === -1) return null;
  const cur = master[at];
  const nextName = String(name ?? '').trim();
  const nextMobile = String(mobile ?? '').trim();
  if (String(cur[nameKey] ?? '') === nextName && String(cur[mobileKey] ?? '') === nextMobile) return null;
  const copy = [...master];
  copy[at] = { ...cur, [nameKey]: nextName, [mobileKey]: nextMobile };
  return copy;
}

/**
 * Empty the sheet's slot — but only while it still names the person leaving.
 *
 * A slot naming somebody else is the office's own record of who works there,
 * and a transfer of a different person is no reason to erase it.
 */
export function clearedMasterSlot(
  master: MasterRec[] | undefined,
  crsId: number,
  role: StaffRole,
  leaving: string,
): MasterRec[] | null {
  if (!Array.isArray(master)) return null;
  const [nameKey] = slotFields(role);
  const at = master.findIndex((m) => Number(m?.id) === Number(crsId));
  if (at === -1) return null;
  if (norm(master[at][nameKey]) !== norm(leaving)) return null;
  return withMasterSlot(master, crsId, role, '', '');
}

export type TransferBlock<T extends Assignee = Assignee> = { kind: 'occupied'; holder: T };
export type TransferPlan<T extends Assignee = Assignee> = {
  /** Set when the destination post is taken; the admin replaces or cancels. */
  blocked: TransferBlock<T> | null;
  /** The post this move empties at the old shop, if any. */
  vacates: { crsId: number; role: StaffRole } | null;
  /** The username change the move implies, or null to keep the current one. */
  username: string | null;
  /** Moving to the post they already hold changes nothing. */
  noop: boolean;
};

/**
 * What moving one person to a shop and post would involve, before doing any of
 * it. `blocked` is advisory: the caller may go ahead by removing the holder
 * first, which is what "Replace" does.
 */
export function planTransfer<T extends Assignee>(users: T[], user: T, toCrsId: number, toRole: StaffRole): TransferPlan<T> {
  const holder = occupant(users, toCrsId, toRole);
  const sameSeat = user.crsId === toCrsId && user.role === toRole;
  return {
    blocked: holder && holder.id !== user.id ? { kind: 'occupied', holder } : null,
    vacates:
      user.crsId && !sameSeat && (user.role === 'BC' || user.role === 'Packer')
        ? { crsId: user.crsId, role: user.role }
        : null,
    username: sameSeat ? null : usernameOnTransfer(user.username, user.crsId, toCrsId),
    noop: sameSeat,
  };
}

/**
 * Is this account allowed to sign in?
 *
 * A Bill Clerk or Packer works AT a shop — there is no such thing as one at
 * large. An unassigned shop account is a login that lands nowhere, and worse:
 * the scope guard on /api/state reads a null crsId as "administrator", so the
 * session would carry write access to every shop in the region. Removing
 * someone from their shop therefore ends their login, and this is the rule
 * that makes that true however the account got into that state.
 */
export function canSignIn(role: string, crsId: number | null | undefined): boolean {
  if (role === 'ADMIN') return true;
  return typeof crsId === 'number' && Number.isFinite(crsId);
}
