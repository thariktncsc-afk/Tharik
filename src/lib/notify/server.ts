/**
 * Notifications — the service every approval workflow and the Messages page
 * call. Route handlers only: it holds the secret-key Supabase client.
 *
 * NEVER BREAKS AN APPROVAL. A payment being submitted or a clear being
 * approved is the real work; the notification is news about it. So the two
 * approval calls swallow and log their own failures — including the tables not
 * existing yet because 0005_notifications.sql has not been run — and the
 * workflow proceeds exactly as it did before this module existed. Only
 * sendMessage throws, because there an administrator is waiting to be told
 * whether their message went out.
 *
 * SCOPING IS BY QUERY, NOT BY FILTER. Every read and write a non-administrator
 * can reach is written with `recipient_user_id = <the session's user>` in the
 * query itself. There is no code path that loads other people's rows and then
 * hides them, so there is none that can forget to.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  categoryOf,
  describeAudience,
  markPatch,
  readStats,
  requiresAck,
  resolveAudience,
  type ApprovalType,
  type Audience,
  type Category,
  type Detail,
  type InboxItem,
  type MarkAction,
  type NotificationType,
  type Priority,
  type RecipientReport,
  type Roster,
  type SentMessage,
} from './core';

export type Person = { userId: number | null; name: string; role: string; crsId: number | null };

const MISSING = new Set(['PGRST205', '42P01']);
export const tablesMissing = (e: { code?: string } | null | undefined) => !!e && MISSING.has(String(e.code ?? ''));

export const MIGRATION_HINT = 'Notifications are not installed yet — run supabase/migrations/0005_notifications.sql.';

let warnedMissing = false;
function warnMissing() {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(`[notify] ${MIGRATION_HINT} Approval workflows continue without notifications.`);
}

/** Run a notification side-effect without ever letting it fail the caller. */
async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (tablesMissing(err)) warnMissing();
    else console.error(`[notify] ${label} failed:`, err?.code ?? '', err?.message ?? e);
  }
}

// ── Lookups ────────────────────────────────────────────────────────────────

async function roster(): Promise<Roster[]> {
  const { data, error } = await supabaseAdmin().from('users').select('id, full_name, role, crs_id, active');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    fullName: String(r.full_name ?? ''),
    role: String(r.role ?? ''),
    crsId: r.crs_id == null ? null : Number(r.crs_id),
    active: r.active !== false,
  }));
}

/** A shop's Tamil name from the masters, or '' — the wording falls back to "CRS 19". */
export async function shopName(crsId: number | null): Promise<string> {
  if (!crsId) return '';
  const { data } = await supabaseAdmin().from('crs_state').select('data').eq('scope', 'global').eq('store_key', '__shops').maybeSingle();
  const rows = Array.isArray(data?.data) ? (data!.data as { name?: string }[]) : [];
  return String(rows[crsId - 1]?.name ?? '');
}

/** Full name and role for a user id — the session cookie only carries the username. */
export async function personFor(userId: number | null, fallbackName: string, fallbackRole: string, crsId: number | null): Promise<Person> {
  if (!userId) return { userId: null, name: fallbackName, role: fallbackRole, crsId };
  const { data } = await supabaseAdmin().from('users').select('full_name, role, crs_id').eq('id', userId).maybeSingle();
  return {
    userId,
    name: String(data?.full_name ?? fallbackName),
    role: String(data?.role ?? fallbackRole),
    crsId: data?.crs_id == null ? crsId : Number(data.crs_id),
  };
}

// ── Writing ────────────────────────────────────────────────────────────────

type NewNotification = {
  type: NotificationType;
  title: string;
  message: string;
  details: Detail[];
  priority: Priority;
  status: string;
  sender: Person | null;
  module: string | null;
  requestId: string | null;
  crsId: number | null;
  link: string | null;
  audience?: Record<string, unknown>;
};

/**
 * One notification and one row per recipient, or nothing at all.
 *
 * PostgREST has no transaction across two inserts, so a failed recipient
 * insert deletes the notification it belonged to. A notification with no
 * recipients is invisible to everyone and would only confuse the sent list.
 */
async function insertNotification(n: NewNotification, recipients: Roster[]): Promise<number | null> {
  if (!recipients.length) return null;
  const db = supabaseAdmin();
  const category: Category = categoryOf(n.type, n.module);

  const { data, error } = await db
    .from('notifications')
    .insert({
      type: n.type,
      category,
      title: n.title,
      message: n.message,
      details: n.details,
      priority: n.priority,
      status: n.status,
      sender_user_id: n.sender?.userId ?? null,
      sender_name: n.sender?.name ?? '',
      related_request_id: n.requestId,
      related_module: n.module,
      related_crs_id: n.crsId,
      link: n.link,
      audience: n.audience ?? {},
      requires_ack: requiresAck(n.type, n.priority),
    })
    .select('id, created_at')
    .single();
  if (error) throw error;

  const id = Number(data.id);
  const { error: rErr } = await db.from('notification_recipients').insert(
    recipients.map((u) => ({
      notification_id: id,
      recipient_user_id: u.id,
      recipient_crs_id: u.crsId,
      recipient_name: u.fullName,
      recipient_role: u.role,
      category,
      created_at: data.created_at,
    })),
  );
  if (rErr) {
    await db.from('notifications').delete().eq('id', id);
    throw rErr;
  }
  return id;
}

// ── Approvals ──────────────────────────────────────────────────────────────

export type ApprovalRequest = {
  type: ApprovalType;
  /** The route family the request lives under, e.g. 'payments', 'clear-requests'. */
  module: string;
  requestId: string | number;
  crsId: number | null;
  requester: Person;
  title: string;
  message: string;
  details: Detail[];
  /** Where an administrator decides it. */
  link: string;
  priority?: Priority;
};

/**
 * A request needs an administrator: tell every active administrator.
 *
 * The requester is recorded as the sender. That is not decoration — it is how
 * notifyApprovalDecided finds who to tell, for any module, without each module
 * having to carry its own idea of who asked.
 */
export async function notifyApprovalRequested(req: ApprovalRequest): Promise<void> {
  await safely(`request ${req.module}#${req.requestId}`, async () => {
    const admins = (await roster()).filter((u) => u.role === 'ADMIN' && u.active && u.id !== req.requester.userId);
    await insertNotification(
      {
        type: req.type,
        title: req.title,
        message: req.message,
        details: req.details,
        priority: req.priority ?? 'normal',
        status: 'pending',
        sender: req.requester,
        module: req.module,
        requestId: String(req.requestId),
        crsId: req.crsId,
        link: req.link,
      },
      admins,
    );
  });
}

export type ApprovalDecision = {
  module: string;
  requestId: string | number;
  decision: 'approved' | 'rejected' | 'cancelled' | 'cleared';
  actor: Person;
  crsId: number | null;
  /** The result the requester reads. Omit for a withdrawal — they did it themselves. */
  result?: { title: string; message: string; details: Detail[]; link: string | null };
  /** Who asked, when the request predates notifications and has no sender to find. */
  requesterIds?: number[];
};

/**
 * A request was decided: settle the administrators' copy, tell the requester.
 *
 * Only notifications still `pending` are moved. A payment rejected yesterday
 * and resubmitted today has two request notifications; approving today's must
 * not rewrite yesterday's to "approved" when it really was rejected.
 */
export async function notifyApprovalDecided(d: ApprovalDecision): Promise<void> {
  await safely(`decision ${d.module}#${d.requestId}`, async () => {
    const db = supabaseAdmin();
    const { data: open, error } = await db
      .from('notifications')
      .select('id, sender_user_id')
      .eq('related_module', d.module)
      .eq('related_request_id', String(d.requestId))
      .eq('status', 'pending');
    if (error) throw error;

    if (open?.length) {
      const { error: uErr } = await db
        .from('notifications')
        .update({ status: d.decision })
        .in('id', open.map((n) => n.id));
      if (uErr) throw uErr;
    }

    if (!d.result) return;
    const askers = new Set<number>([
      ...(open ?? []).map((n) => Number(n.sender_user_id)).filter((n) => Number.isInteger(n) && n > 0),
      ...(d.requesterIds ?? []).filter((n) => Number.isInteger(n) && n > 0),
    ]);
    if (d.actor.userId) askers.delete(d.actor.userId);
    if (!askers.size) return;

    // Told even if their account has since been disabled: the decision is
    // theirs to see whenever they can next sign in.
    const people = (await roster()).filter((u) => askers.has(u.id));
    await insertNotification(
      {
        type: 'APPROVAL_RESULT',
        title: d.result.title,
        message: d.result.message,
        details: d.result.details,
        priority: 'normal',
        status: d.decision,
        sender: d.actor,
        module: d.module,
        requestId: String(d.requestId),
        crsId: d.crsId,
        link: d.result.link,
      },
      people,
    );
  });
}

// ── Messages ───────────────────────────────────────────────────────────────

/** Throws — an administrator is waiting to know whether it went out. */
export async function sendMessage(input: {
  sender: Person;
  title: string;
  message: string;
  priority: Priority;
  audience: Audience;
}): Promise<{ id: number; recipients: number }> {
  const people = resolveAudience(await roster(), input.audience);
  if (!people.length) throw Object.assign(new Error('Nobody matches that selection — no active BC or Packer is assigned there.'), { status: 400 });

  const id = await insertNotification(
    {
      type: 'MESSAGE',
      title: input.title,
      message: input.message,
      details: [],
      priority: input.priority,
      status: 'sent',
      sender: input.sender,
      module: null,
      requestId: null,
      crsId: input.audience.mode === 'shop' ? input.audience.crsId : null,
      link: null,
      audience: { ...input.audience, label: describeAudience(input.audience) },
    },
    people,
  );
  return { id: id as number, recipients: people.length };
}

// ── Reading one person's inbox ─────────────────────────────────────────────

const INBOX_COLUMNS =
  'notification_id, delivered_at, opened_at, read_at, acknowledged_at, is_read, created_at, ' +
  'n:notifications(id, type, category, title, message, details, priority, status, sender_name, related_module, related_request_id, related_crs_id, link, requires_ack, created_at)';

type InboxRow = {
  notification_id: number;
  delivered_at: string | null;
  opened_at: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
  is_read: boolean;
  created_at: string;
  n: Record<string, unknown> | null;
};

function toItem(r: InboxRow): InboxItem | null {
  const n = r.n;
  if (!n) return null;
  return {
    id: Number(n.id),
    type: n.type as NotificationType,
    category: n.category as Category,
    title: String(n.title ?? ''),
    message: String(n.message ?? ''),
    details: Array.isArray(n.details) ? (n.details as Detail[]) : [],
    priority: (n.priority as Priority) ?? 'normal',
    status: String(n.status ?? ''),
    senderName: String(n.sender_name ?? ''),
    relatedModule: (n.related_module as string) ?? null,
    relatedRequestId: (n.related_request_id as string) ?? null,
    relatedCrsId: n.related_crs_id == null ? null : Number(n.related_crs_id),
    link: (n.link as string) ?? null,
    requiresAck: n.requires_ack === true,
    createdAt: String(n.created_at ?? r.created_at),
    deliveredAt: r.delivered_at,
    openedAt: r.opened_at,
    readAt: r.read_at,
    acknowledgedAt: r.acknowledged_at,
    isRead: r.is_read === true,
  };
}

export async function listForUser(
  userId: number,
  opts: { category?: Category | null; unreadOnly?: boolean; limit?: number; before?: string | null },
): Promise<InboxItem[]> {
  let q = supabaseAdmin()
    .from('notification_recipients')
    .select(INBOX_COLUMNS)
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 30, 1), 200));
  if (opts.category) q = q.eq('category', opts.category);
  if (opts.unreadOnly) q = q.eq('is_read', false);
  if (opts.before) q = q.lt('created_at', opts.before);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown as InboxRow[]).map(toItem).filter((x): x is InboxItem => !!x);
}

/**
 * What the bell needs on every poll, and the one write a poll is allowed.
 *
 * Polling records DELIVERY — this person's screen has now received it — and
 * nothing more. Being delivered is not being read: the read time is only ever
 * set by the person opening it, acknowledging it or marking it read.
 */
export async function summaryForUser(userId: number): Promise<{ unread: number; latestAt: string | null; popups: InboxItem[] }> {
  const db = supabaseAdmin();

  const { error: dErr } = await db
    .from('notification_recipients')
    .update({ delivered_at: new Date().toISOString() })
    .eq('recipient_user_id', userId)
    .is('delivered_at', null);
  if (dErr) throw dErr;

  const { count, error: cErr } = await db
    .from('notification_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_user_id', userId)
    .eq('is_read', false);
  if (cErr) throw cErr;

  const { data: latest } = await db
    .from('notification_recipients')
    .select('created_at')
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  // Messages waiting to be acknowledged. Only messages can require it, so the
  // category index narrows this before the embedded flag is checked.
  const { data: waiting, error: pErr } = await db
    .from('notification_recipients')
    .select(INBOX_COLUMNS)
    .eq('recipient_user_id', userId)
    .eq('category', 'messages')
    .is('acknowledged_at', null)
    .order('created_at', { ascending: true })
    .limit(20);
  if (pErr) throw pErr;
  const popups = ((waiting ?? []) as unknown as InboxRow[])
    .map(toItem)
    .filter((x): x is InboxItem => !!x && x.requiresAck);

  return { unread: count ?? 0, latestAt: (latest?.[0]?.created_at as string) ?? null, popups };
}

/** Open, read or acknowledge one of THIS person's notifications. */
export async function markForUser(userId: number, notificationId: number, action: MarkAction): Promise<InboxItem | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('notification_recipients')
    .select(INBOX_COLUMNS)
    .eq('recipient_user_id', userId)
    .eq('notification_id', notificationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as InboxRow;
  const patch = markPatch(
    { deliveredAt: row.delivered_at, openedAt: row.opened_at, readAt: row.read_at, acknowledgedAt: row.acknowledged_at, isRead: row.is_read },
    action,
    new Date().toISOString(),
  );
  if (!patch) return toItem(row);

  const { data: after, error: uErr } = await db
    .from('notification_recipients')
    .update(patch)
    .eq('recipient_user_id', userId)
    .eq('notification_id', notificationId)
    .select(INBOX_COLUMNS)
    .maybeSingle();
  if (uErr) throw uErr;
  return after ? toItem(after as unknown as InboxRow) : null;
}

/** Mark every unread notification of THIS person read, optionally within one filter. */
export async function markAllForUser(userId: number, category: Category | null): Promise<number> {
  const now = new Date().toISOString();
  let q = supabaseAdmin()
    .from('notification_recipients')
    .update({ is_read: true, read_at: now })
    .eq('recipient_user_id', userId)
    .eq('is_read', false);
  if (category) q = q.eq('category', category);
  const { data, error } = await q.select('id');
  if (error) throw error;
  // Anything marked read has also been received.
  await supabaseAdmin().from('notification_recipients').update({ delivered_at: now }).eq('recipient_user_id', userId).is('delivered_at', null);
  return data?.length ?? 0;
}

// ── The administrator's view of their messages ────────────────────────────

export async function sentMessages(limit = 50): Promise<SentMessage[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('notifications')
    .select('id, title, message, priority, sender_name, audience, requires_ack, created_at')
    .eq('type', 'MESSAGE')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw error;
  if (!data?.length) return [];

  const ids = data.map((n) => n.id);
  const { data: rows, error: rErr } = await db
    .from('notification_recipients')
    .select('notification_id, delivered_at, opened_at, read_at, acknowledged_at, is_read')
    .in('notification_id', ids);
  if (rErr) throw rErr;

  const byId = new Map<number, { deliveredAt: string | null; openedAt: string | null; readAt: string | null; acknowledgedAt: string | null; isRead: boolean }[]>();
  for (const r of rows ?? []) {
    const list = byId.get(Number(r.notification_id)) ?? [];
    list.push({ deliveredAt: r.delivered_at, openedAt: r.opened_at, readAt: r.read_at, acknowledgedAt: r.acknowledged_at, isRead: r.is_read === true });
    byId.set(Number(r.notification_id), list);
  }

  return data.map((n) => ({
    id: Number(n.id),
    title: String(n.title ?? ''),
    message: String(n.message ?? ''),
    priority: (n.priority as Priority) ?? 'normal',
    senderName: String(n.sender_name ?? ''),
    audienceLabel: String((n.audience as { label?: string })?.label ?? ''),
    requiresAck: n.requires_ack === true,
    createdAt: String(n.created_at),
    stats: readStats(byId.get(Number(n.id)) ?? []),
  }));
}

export async function messageRecipients(notificationId: number): Promise<RecipientReport[] | null> {
  const db = supabaseAdmin();
  const { data: n, error } = await db.from('notifications').select('id, type').eq('id', notificationId).maybeSingle();
  if (error) throw error;
  if (!n || n.type !== 'MESSAGE') return null;

  const { data, error: rErr } = await db
    .from('notification_recipients')
    .select('recipient_user_id, recipient_crs_id, recipient_name, recipient_role, delivered_at, opened_at, read_at, acknowledged_at, is_read')
    .eq('notification_id', notificationId)
    .order('recipient_crs_id', { ascending: true });
  if (rErr) throw rErr;
  return (data ?? []).map((r) => ({
    userId: Number(r.recipient_user_id),
    crsId: r.recipient_crs_id == null ? null : Number(r.recipient_crs_id),
    name: String(r.recipient_name ?? ''),
    role: String(r.recipient_role ?? ''),
    deliveredAt: r.delivered_at,
    openedAt: r.opened_at,
    readAt: r.read_at,
    acknowledgedAt: r.acknowledged_at,
    isRead: r.is_read === true,
  }));
}
