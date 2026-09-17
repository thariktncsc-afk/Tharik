/**
 * The two approval workflows that exist today, described to the notification
 * service. Route handlers only.
 *
 * Each workflow contributes exactly two things: what its request looks like
 * (wording from core.ts) and where it is decided (a link). The fan-out to
 * administrators, the status that follows a decision and the result that
 * reaches the requester are the service's. A future Edit or Data Correction
 * module adds its own pair of functions here and calls them the same way.
 *
 * NONE OF THESE THROW. They are called after the real work has been saved —
 * the payment recorded, the clear performed — and a lookup failing on the way
 * to a notification must not turn a completed approval into an error screen.
 */
import type { Session } from '@/lib/session';
import { CLEAR_STORE_KEY, type StoredRequest } from '@/lib/clearStore';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { clearRequestText, clearResultText, paymentRequestText, paymentResultText, type ClearFacts, type PaymentFacts } from './core';
import { notifyApprovalDecided, notifyApprovalRequested, personFor, shopName, type Person } from './server';

/** The fields of a payment order these need — structurally, so lib does not import a route. */
export type OrderLike = {
  id: number;
  orderNo: string;
  userId: number;
  username: string;
  fullName: string;
  crsId: number;
  kind: 'statement' | 'dss';
  month: number;
  year: number;
  sheetCount: number;
  dayCount: number;
  totalPaise: number;
  utr: string;
  submittedAt: string | null;
  createdAt: string;
};

async function quietly(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[notify] ${label}:`, e instanceof Error ? e.message : e);
  }
}

const paymentLink = (id: number) => `/payments?id=${id}`;
const clearLink = (id: number) => `/clear-requests?id=${id}`;

async function paymentFacts(o: OrderLike, requester: Person): Promise<PaymentFacts> {
  return {
    orderNo: o.orderNo,
    crsId: o.crsId,
    shopName: await shopName(o.crsId),
    requesterName: requester.name || o.fullName || o.username,
    requesterRole: requester.role,
    kind: o.kind,
    month: o.month,
    year: o.year,
    sheetCount: o.sheetCount,
    dayCount: o.dayCount,
    totalPaise: o.totalPaise,
    utr: o.utr || undefined,
    submittedAt: o.submittedAt ?? o.createdAt,
  };
}

/**
 * A shop has paid and typed its UTR — the moment an administrator has work.
 * Raising an order is not: an unpaid `pending` order is nobody's to approve.
 */
export async function onPaymentSubmitted(o: OrderLike, s: Session): Promise<void> {
  await quietly(`payment #${o.id} submitted`, async () => {
    const requester = await personFor(s.userId, o.fullName || s.username, s.role, o.crsId);
    const w = paymentRequestText(await paymentFacts(o, requester));
    await notifyApprovalRequested({
      type: 'PAYMENT_REQUEST',
      module: 'payments',
      requestId: o.id,
      crsId: o.crsId,
      requester,
      ...w,
      link: paymentLink(o.id),
    });
  });
}

export async function onPaymentDecided(o: OrderLike, s: Session, decision: 'approved' | 'rejected', reason: string): Promise<void> {
  await quietly(`payment #${o.id} ${decision}`, async () => {
    const actor = await personFor(s.userId, s.username, s.role, null);
    // Worded from the order's own requester, not the administrator deciding it.
    const requester = await personFor(o.userId, o.fullName || o.username, '', o.crsId);
    const w = paymentResultText(await paymentFacts(o, requester), decision, reason);
    await notifyApprovalDecided({
      module: 'payments',
      requestId: o.id,
      decision,
      actor,
      crsId: o.crsId,
      result: { ...w, link: paymentLink(o.id) },
      // Whoever raised the order hears the outcome even if a colleague at the
      // same shop submitted the UTR — that colleague is found as the sender of
      // the request notification.
      requesterIds: [o.userId],
    });
  });
}

async function clearFacts(r: StoredRequest, requester: Person): Promise<ClearFacts> {
  return {
    id: r.id,
    crsId: r.crsId,
    shopName: r.shopName || (await shopName(r.crsId)),
    modules: r.modules ?? [],
    scopeKind: r.scopeKind,
    scopeLabel: r.scopeLabel,
    requesterName: requester.name || r.requestedBy,
    requesterRole: requester.role || r.requestedRole,
    reason: r.reason,
    createdAt: r.createdAt,
  };
}

export async function onClearRequested(r: StoredRequest, s: Session): Promise<void> {
  await quietly(`clear #${r.id} requested`, async () => {
    const requester = await personFor(s.userId ?? null, r.requestedBy, r.requestedRole, r.crsId);
    const w = clearRequestText(await clearFacts(r, requester));
    await notifyApprovalRequested({
      type: 'CLEAR_REQUEST',
      module: 'clear-requests',
      requestId: r.id,
      crsId: r.crsId,
      requester,
      ...w,
      link: clearLink(r.id),
    });
  });
}

// ── Requests that are waiting but were never announced ────────────────────

let backfilled: Promise<number> | null = null;

/**
 * Every request still waiting for an administrator gets its notification, if
 * it does not have one yet.
 *
 * A request raised while notifications were not installed (0005 not run), or
 * whose notification failed to write, is otherwise invisible in the bell for
 * good. This only READS the requests — payment_orders and the clear-request
 * record are never written — and notifyApprovalRequested skips any request
 * already notified, so running it again adds nothing.
 *
 * Waiting means: a payment `awaiting_approval` (paid, UTR typed — an unpaid
 * `pending` order is nobody's to approve), a clear request `pending`.
 *
 * Once per server process, the first time an administrator's bell asks; a
 * failure lets the next ask try again. Returns how many were created.
 */
export function backfillPendingApprovals(): Promise<number> {
  if (!backfilled) {
    backfilled = runBackfill().catch((e) => {
      backfilled = null;
      console.error('[notify] backfill:', e instanceof Error ? e.message : e);
      return 0;
    });
  }
  return backfilled;
}

async function runBackfill(): Promise<number> {
  const db = supabaseAdmin();
  let created = 0;

  const { data: orders, error } = await db
    .from('payment_orders')
    .select('id, order_no, user_id, username, full_name, crs_id, kind, month, year, sheet_count, day_count, total_paise, utr, submitted_at, created_at')
    .eq('status', 'awaiting_approval')
    .order('id', { ascending: true });
  if (error && !['PGRST205', '42P01'].includes(String(error.code))) throw error;
  for (const r of orders ?? []) {
    const o: OrderLike = {
      id: Number(r.id),
      orderNo: String(r.order_no ?? ''),
      userId: Number(r.user_id),
      username: String(r.username ?? ''),
      fullName: String(r.full_name ?? ''),
      crsId: Number(r.crs_id),
      kind: r.kind === 'dss' ? 'dss' : 'statement',
      month: Number(r.month),
      year: Number(r.year),
      sheetCount: Number(r.sheet_count) || 0,
      dayCount: Number(r.day_count) || 0,
      totalPaise: Number(r.total_paise) || 0,
      utr: String(r.utr ?? ''),
      submittedAt: (r.submitted_at as string) ?? null,
      createdAt: String(r.created_at),
    };
    const requester = await personFor(o.userId, o.fullName || o.username, '', o.crsId);
    const w = paymentRequestText(await paymentFacts(o, requester));
    if (await notifyApprovalRequested({ type: 'PAYMENT_REQUEST', module: 'payments', requestId: o.id, crsId: o.crsId, requester, ...w, link: paymentLink(o.id) })) created++;
  }

  const { data: row } = await db.from('crs_state').select('data').eq('scope', 'global').eq('store_key', CLEAR_STORE_KEY).maybeSingle();
  const requests = ((row?.data as { requests?: StoredRequest[] } | null)?.requests ?? []).filter((r) => r.status === 'pending');
  for (const r of requests) {
    const requester = await personFor(r.requestedById ?? null, r.requestedBy, r.requestedRole, r.crsId);
    const w = clearRequestText(await clearFacts(r, requester));
    if (await notifyApprovalRequested({ type: 'CLEAR_REQUEST', module: 'clear-requests', requestId: r.id, crsId: r.crsId, requester, ...w, link: clearLink(r.id) })) created++;
  }

  if (created) console.log(`[notify] backfill: ${created} waiting request(s) announced to administrators`);
  return created;
}

/**
 * `cleared` is the only approval outcome for a clear — approving performs the
 * deletion, and the requester is told once it has actually happened, never
 * before. A failed clear goes back to pending and tells nobody, because
 * nothing was decided. A withdrawal settles the administrators' copy and
 * tells the requester nothing: they are the one who withdrew it.
 */
export async function onClearDecided(r: StoredRequest, s: Session, decision: 'cleared' | 'rejected' | 'cancelled', note: string): Promise<void> {
  await quietly(`clear #${r.id} ${decision}`, async () => {
    const actor = await personFor(s.userId ?? null, s.username, s.role, null);
    if (decision === 'cancelled') {
      await notifyApprovalDecided({ module: 'clear-requests', requestId: r.id, decision, actor, crsId: r.crsId });
      return;
    }
    const requester = await personFor(r.requestedById ?? null, r.requestedBy, r.requestedRole, r.crsId);
    const w = clearResultText(await clearFacts(r, requester), decision, note);
    await notifyApprovalDecided({
      module: 'clear-requests',
      requestId: r.id,
      decision,
      actor,
      crsId: r.crsId,
      result: { ...w, link: clearLink(r.id) },
      requesterIds: r.requestedById ? [r.requestedById] : [],
    });
  });
}
