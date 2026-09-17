/**
 * Notifications — the rules, with no database and no framework.
 *
 * Everything here is a pure function over plain data, so the server service,
 * the screens and tools/verify-notifications.mjs all share one definition of
 * what a notification is, who a message reaches, what an approval says, and
 * what "read" means.
 *
 * THE CENTRAL IDEA. Every approval workflow — payments and clears today, edits,
 * deletions and corrections tomorrow — is the same three steps: somebody asks,
 * an administrator decides, the asker is told. A module describes its own
 * request in a few lines of wording and calls the service; the fan-out to
 * administrators, the status that follows the decision, and the result that
 * finds its way back to the requester are all done once, here and in
 * server.ts. A new approval module needs a wording function and two calls.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export const APPROVAL_TYPES = [
  'PAYMENT_REQUEST',
  'CLEAR_REQUEST',
  'EDIT_REQUEST',
  'DELETE_REQUEST',
  'DATA_CORRECTION_REQUEST',
  'DOWNLOAD_APPROVAL',
  'OTHER_APPROVAL',
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export type NotificationType = ApprovalType | 'APPROVAL_RESULT' | 'MESSAGE' | 'SYSTEM';

export type Category = 'payments' | 'clear' | 'approvals' | 'messages' | 'system';
export type Priority = 'normal' | 'important' | 'urgent';
export const PRIORITIES: readonly Priority[] = ['normal', 'important', 'urgent'];

export type StaffRole = 'BC' | 'Packer';
export const STAFF_ROLES: readonly StaffRole[] = ['BC', 'Packer'];

/** One labelled line of a notification. `date` values are ISO, formatted by the reader. */
export type Detail = { label: string; value: string; kind?: 'date' };

/** A person's copy of a notification, as the bell and the history page see it. */
export type InboxItem = {
  id: number;
  type: NotificationType;
  category: Category;
  title: string;
  message: string;
  details: Detail[];
  priority: Priority;
  status: string;
  senderName: string;
  relatedModule: string | null;
  relatedRequestId: string | null;
  relatedCrsId: number | null;
  link: string | null;
  requiresAck: boolean;
  createdAt: string;
  deliveredAt: string | null;
  openedAt: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  isRead: boolean;
};

export type ReadStats = { recipients: number; delivered: number; read: number; unread: number; acknowledged: number };

/** One recipient's line in a message's read report. */
export type RecipientReport = {
  userId: number;
  crsId: number | null;
  name: string;
  role: string;
  deliveredAt: string | null;
  openedAt: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  isRead: boolean;
};

export type SentMessage = {
  id: number;
  title: string;
  message: string;
  priority: Priority;
  senderName: string;
  audienceLabel: string;
  requiresAck: boolean;
  createdAt: string;
  stats: ReadStats;
};

// ── Classification ─────────────────────────────────────────────────────────

export const isApprovalType = (t: string): t is ApprovalType => (APPROVAL_TYPES as readonly string[]).includes(t);

/**
 * The filter a notification sits under. A result is filed with the request it
 * answers — a payment approval belongs with payments, not in a generic pile —
 * so it is placed by the module that raised it.
 */
export function categoryOf(type: NotificationType, module?: string | null): Category {
  switch (type) {
    case 'PAYMENT_REQUEST':
    case 'DOWNLOAD_APPROVAL':
      return 'payments';
    case 'CLEAR_REQUEST':
    case 'DELETE_REQUEST':
      return 'clear';
    case 'EDIT_REQUEST':
    case 'DATA_CORRECTION_REQUEST':
    case 'OTHER_APPROVAL':
      return 'approvals';
    case 'APPROVAL_RESULT':
      return module === 'payments' ? 'payments' : module === 'clear-requests' ? 'clear' : 'approvals';
    case 'MESSAGE':
      return 'messages';
    default:
      return 'system';
  }
}

/**
 * Important and urgent messages must be acknowledged; a normal one is simply
 * read. Approval traffic never pops up — it is work in a queue, not an
 * announcement, and a modal on every payment would train people to dismiss it.
 */
export const requiresAck = (type: NotificationType, priority: Priority): boolean => type === 'MESSAGE' && priority !== 'normal';

export const parsePriority = (v: unknown): Priority => (PRIORITIES.includes(v as Priority) ? (v as Priority) : 'normal');

/** Where a request stands, in words a shop user reads. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending Approval';
    case 'approved':
    case 'cleared':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Withdrawn';
    default:
      return '';
  }
}

// ── Audience ───────────────────────────────────────────────────────────────

export type Roster = { id: number; fullName: string; role: string; crsId: number | null; active: boolean };

export type Audience =
  | { mode: 'users'; userIds: number[] }
  | { mode: 'shop'; crsId: number; roles: StaffRole[] }
  | { mode: 'shops'; crsIds: number[]; roles: StaffRole[] }
  | { mode: 'roles'; roles: StaffRole[] }
  | { mode: 'all' };

const ints = (v: unknown): number[] =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
const roles = (v: unknown): StaffRole[] =>
  [...new Set((Array.isArray(v) ? v : []).map(String))].filter((r): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r));

/**
 * Validate an audience as posted. The server calls this on the request body,
 * so a hand-built request cannot address anyone the form could not.
 */
export function parseAudience(raw: unknown): Audience | { error: string } {
  const a = (raw ?? {}) as Record<string, unknown>;
  switch (a.mode) {
    case 'users': {
      const userIds = ints(a.userIds);
      return userIds.length ? { mode: 'users', userIds } : { error: 'Choose at least one user.' };
    }
    case 'shop': {
      const crsId = Number(a.crsId);
      const r = roles(a.roles);
      if (!Number.isInteger(crsId) || crsId <= 0) return { error: 'Choose a CRS shop.' };
      return r.length ? { mode: 'shop', crsId, roles: r } : { error: 'Choose BC, Packer or both.' };
    }
    case 'shops': {
      const crsIds = ints(a.crsIds);
      const r = roles(a.roles);
      if (!crsIds.length) return { error: 'Tick at least one CRS shop.' };
      return r.length ? { mode: 'shops', crsIds, roles: r } : { error: 'Choose BC, Packer or both.' };
    }
    case 'roles': {
      const r = roles(a.roles);
      return r.length ? { mode: 'roles', roles: r } : { error: 'Choose at least one role.' };
    }
    case 'all':
      return { mode: 'all' };
    default:
      return { error: 'Choose who the message is for.' };
  }
}

/**
 * The people a message actually reaches.
 *
 * Only ACTIVE SHOP STAFF: an administrator is not a CRS user, a disabled
 * account cannot read anything, and an account with no shop cannot sign in
 * (engine/staffAssignment.ts canSignIn). Addressing someone who can never open
 * the message would put a permanent "unread" in the report that nobody could
 * clear. Deduplicated, and ordered by shop then role so the report reads the
 * way the office's list does.
 */
export function resolveAudience(roster: Roster[], a: Audience): Roster[] {
  const reachable = roster.filter((u) => u.active !== false && u.role !== 'ADMIN' && typeof u.crsId === 'number');
  let picked: Roster[];
  switch (a.mode) {
    case 'users': {
      const want = new Set(a.userIds);
      picked = reachable.filter((u) => want.has(u.id));
      break;
    }
    case 'shop':
      picked = reachable.filter((u) => u.crsId === a.crsId && (a.roles as string[]).includes(u.role));
      break;
    case 'shops': {
      const want = new Set(a.crsIds);
      picked = reachable.filter((u) => want.has(u.crsId as number) && (a.roles as string[]).includes(u.role));
      break;
    }
    case 'roles':
      picked = reachable.filter((u) => (a.roles as string[]).includes(u.role));
      break;
    default:
      picked = reachable;
  }
  const seen = new Set<number>();
  return picked
    .filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)))
    .sort((x, y) => (x.crsId ?? 0) - (y.crsId ?? 0) || x.role.localeCompare(y.role) || x.fullName.localeCompare(y.fullName));
}

const roleWords = (r: StaffRole[]) => (r.length === 2 ? 'BC & Packer' : r[0] === 'BC' ? 'BC only' : 'Packer only');

/** "CRS 1, CRS 7, CRS 19 · BC & Packer" — how the sent list says who it went to. */
export function describeAudience(a: Audience): string {
  switch (a.mode) {
    case 'users':
      return `${a.userIds.length} selected user${a.userIds.length === 1 ? '' : 's'}`;
    case 'shop':
      return `CRS ${a.crsId} · ${roleWords(a.roles)}`;
    case 'shops': {
      const list = [...a.crsIds].sort((x, y) => x - y);
      const shown = list.length > 6 ? `${list.slice(0, 6).map((n) => `CRS ${n}`).join(', ')} +${list.length - 6} more` : list.map((n) => `CRS ${n}`).join(', ');
      return `${shown} · ${roleWords(a.roles)}`;
    }
    case 'roles':
      return a.roles.length === 2 ? 'All BCs and Packers' : a.roles[0] === 'BC' ? 'All Bill Clerks' : 'All Packers';
    default:
      return 'All CRS shops';
  }
}

// ── Read state ─────────────────────────────────────────────────────────────

export type RecipientState = {
  deliveredAt: string | null;
  openedAt: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  isRead: boolean;
};
export type MarkAction = 'open' | 'read' | 'acknowledge';

/**
 * The columns one action sets, or null when it changes nothing.
 *
 * A timestamp is only ever set, never moved. "Read at 09:32" must stay the
 * moment they first read it: opening the same message again at 10:15 would
 * otherwise quietly rewrite the report the administrator is relying on.
 *
 * Opening reads it. Acknowledging reads it. Marking it read reads it. Nothing
 * else does — in particular not signing in, and not a popup appearing on its
 * own, which is why there is no action for either.
 */
export function markPatch(cur: RecipientState, action: MarkAction, now: string): Record<string, string | boolean> | null {
  const patch: Record<string, string | boolean> = {};
  if (action === 'open' && !cur.openedAt) patch.opened_at = now;
  if (action === 'acknowledge' && !cur.acknowledgedAt) patch.acknowledged_at = now;
  if (!cur.readAt) patch.read_at = now;
  if (!cur.isRead) patch.is_read = true;
  // Something may have been delivered without the poll recording it — a
  // person who opens a notification has, by definition, received it.
  if (!cur.deliveredAt) patch.delivered_at = now;
  return Object.keys(patch).length ? patch : null;
}

export function readStats(rows: RecipientState[]): ReadStats {
  const read = rows.filter((r) => r.isRead || r.readAt).length;
  return {
    recipients: rows.length,
    delivered: rows.filter((r) => r.deliveredAt).length,
    read,
    unread: rows.length - read,
    acknowledged: rows.filter((r) => r.acknowledgedAt).length,
  };
}

// ── Wording ────────────────────────────────────────────────────────────────

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const rupees = (paise: number) =>
  '₹' + (Math.round(Number(paise) || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shopLine = (crsId: number, shopName: string) => (shopName ? `CRS ${crsId} — ${shopName}` : `CRS ${crsId}`);
const who = (name: string, role: string) => (role && role !== 'ADMIN' ? `${name} (${role})` : name);

const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date becomes the DD-MM-YYYY the office writes — from ISO, or from the
 * "16 Sept 2026" a clear request's scope label carries. Anything else (a month
 * name, a receipt number) is left alone.
 */
export function dayLabel(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('-');
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(String(s).trim());
  const mon = m ? MON3.indexOf(m[2].slice(0, 3).toLowerCase()) : -1;
  return m && mon >= 0 ? `${m[1].padStart(2, '0')}-${String(mon + 1).padStart(2, '0')}-${m[3]}` : s;
}

/** "10:35 AM" in India time — when a request was raised, written into its line. */
export function clockIST(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/** "16-09-2026 | Requested by Divya (BC) | 10:35 AM" — the second line of every request. */
export function requestLine(what: string, name: string, role: string, at: string): string {
  return [what, `Requested by ${who(name, role)}`, clockIST(at)].filter(Boolean).join(' | ');
}

export type Wording = { title: string; message: string; details: Detail[] };

export type PaymentFacts = {
  orderNo: string;
  crsId: number;
  shopName: string;
  requesterName: string;
  requesterRole: string;
  kind: 'statement' | 'dss';
  month: number;
  year: number;
  sheetCount: number;
  dayCount: number;
  totalPaise: number;
  utr?: string;
  submittedAt: string;
};

/** "Monthly Statement – September 2026 · 3 sheets" */
export function paymentSubject(p: Pick<PaymentFacts, 'kind' | 'month' | 'year' | 'sheetCount' | 'dayCount'>): string {
  const period = `${MONTHS[p.month] ?? ''} ${p.year}`.trim();
  return p.kind === 'dss'
    ? `DSS – ${period} · ${p.dayCount} day${p.dayCount === 1 ? '' : 's'}`
    : `Monthly Statement – ${period} · ${p.sheetCount} sheet${p.sheetCount === 1 ? '' : 's'}`;
}

export function paymentRequestText(p: PaymentFacts): Wording {
  const subject = paymentSubject(p);
  return {
    title: `CRS ${p.crsId} – ${p.kind === 'dss' ? 'DSS' : 'Statement'} Download Payment Approval`,
    message: requestLine(`${subject} · ${rupees(p.totalPaise)}`, p.requesterName, p.requesterRole, p.submittedAt),
    details: [
      { label: 'CRS', value: shopLine(p.crsId, p.shopName) },
      { label: 'Requested By', value: who(p.requesterName, p.requesterRole) },
      { label: p.kind === 'dss' ? 'Download' : 'Statement', value: subject },
      { label: 'Amount', value: rupees(p.totalPaise) },
      { label: 'Order No', value: p.orderNo },
      ...(p.utr ? [{ label: 'UPI Reference (UTR)', value: p.utr }] : []),
      { label: 'Submitted', value: p.submittedAt, kind: 'date' as const },
      { label: 'Status', value: 'Pending Approval' },
    ],
  };
}

export function paymentResultText(p: PaymentFacts, decision: 'approved' | 'rejected', reason = ''): Wording {
  const what = p.kind === 'dss' ? 'DSS download' : 'statement download';
  const subject = paymentSubject(p);
  const base: Detail[] = [
    { label: 'CRS', value: shopLine(p.crsId, p.shopName) },
    { label: p.kind === 'dss' ? 'Download' : 'Statement', value: subject },
    { label: 'Amount', value: rupees(p.totalPaise) },
    { label: 'Order No', value: p.orderNo },
  ];
  if (decision === 'approved') {
    return {
      title: `CRS ${p.crsId} – Payment Request Approved`,
      message: `Your ${what} payment for ${subject} has been approved. You can now download the ${p.kind === 'dss' ? 'DSS' : 'statement'}.`,
      details: [...base, { label: 'Status', value: 'Approved' }],
    };
  }
  return {
    title: `CRS ${p.crsId} – Payment Request Rejected`,
    message: `Your ${what} payment for ${subject} has been rejected${reason ? `: ${reason}` : '.'} Check the UPI reference and submit it again.`,
    details: [...base, ...(reason ? [{ label: 'Reason', value: reason }] : []), { label: 'Status', value: 'Rejected' }],
  };
}

export type ClearFacts = {
  id: number;
  crsId: number;
  shopName: string;
  modules: string[];
  scopeKind: string;
  scopeLabel: string;
  requesterName: string;
  requesterRole: string;
  reason: string;
  createdAt: string;
};

const scopeField = (kind: string) => (kind === 'month' ? 'Month' : kind === 'receipt' ? 'Receipt' : 'Entry Date');
const moduleWords = (m: string[]) => (m.length ? m.join(', ') : 'the entry');

/** "Daily Sales" / "Monthly Sales" / "Receipt" — what kind of clear this is, by its scope. */
export function clearKind(c: Pick<ClearFacts, 'scopeKind' | 'modules'>): string {
  if (c.scopeKind === 'day') return 'Daily Sales';
  if (c.scopeKind === 'month') return 'Monthly Sales';
  if (c.scopeKind === 'receipt') return 'Receipt';
  return c.modules.length ? c.modules.join(' & ') : 'Entry';
}

export function clearRequestText(c: ClearFacts): Wording {
  const scope = dayLabel(c.scopeLabel);
  return {
    title: `CRS ${c.crsId} – ${clearKind(c)} Clear Request`,
    message: requestLine(scope, c.requesterName, c.requesterRole, c.createdAt),
    details: [
      { label: 'CRS', value: shopLine(c.crsId, c.shopName) },
      { label: 'Module', value: moduleWords(c.modules) },
      { label: scopeField(c.scopeKind), value: scope },
      { label: 'Requested By', value: who(c.requesterName, c.requesterRole) },
      { label: 'Reason', value: c.reason },
      { label: 'Submitted', value: c.createdAt, kind: 'date' },
      { label: 'Status', value: 'Pending' },
    ],
  };
}

export function clearResultText(c: ClearFacts, decision: 'cleared' | 'rejected', note = ''): Wording {
  const scope = dayLabel(c.scopeLabel);
  const request = `${clearKind(c)} Clear Request for ${scope}`;
  const base: Detail[] = [
    { label: 'CRS', value: shopLine(c.crsId, c.shopName) },
    { label: 'Module', value: moduleWords(c.modules) },
    { label: scopeField(c.scopeKind), value: scope },
  ];
  if (decision === 'cleared') {
    return {
      title: `CRS ${c.crsId} – ${clearKind(c)} Clear Request Approved`,
      message: `Your ${request} has been approved. The entry has been cleared and can be keyed again.`,
      details: [...base, ...(note ? [{ label: 'Note', value: note }] : []), { label: 'Status', value: 'Approved' }],
    };
  }
  return {
    title: `CRS ${c.crsId} – ${clearKind(c)} Clear Request Rejected`,
    message: `Your ${request} has been rejected.${note ? ` ${note}` : ''}`,
    details: [...base, ...(note ? [{ label: 'Reason', value: note }] : []), { label: 'Status', value: 'Rejected' }],
  };
}

// ── Limits ─────────────────────────────────────────────────────────────────

export const TITLE_MAX = 200;
/** Detailed messages are the point — this is a ceiling against abuse, not a style guide. */
export const MESSAGE_MAX = 10000;
