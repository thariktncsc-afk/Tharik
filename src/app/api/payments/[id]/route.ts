/**
 * The two transitions an order can make after it is raised.
 *
 *   submit  (customer) pending           → awaiting_approval, with a UTR
 *   approve (admin)    awaiting_approval → approved
 *   reject  (admin)    awaiting_approval → rejected
 *
 * Both admin actions are guarded on the CURRENT status inside the update, not
 * just read-then-write: two admins clicking Approve and Reject at the same
 * moment must not both succeed, and the second one to arrive should find
 * nothing left to change.
 */
import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { isAdmin, readSettings, requireSession } from '@/lib/payments/server';
import { upiUri } from '@/lib/payments/upi';
import { toOrder } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const COLUMNS =
  'id, order_no, user_id, username, full_name, crs_id, kind, month, year, section_ids, sheet_count, day_count, base_paise, gst_paise, total_paise, gst_rate_bp, gst_inclusive, status, utr, reject_reason, created_at, submitted_at, decided_at, decided_by_name';

/**
 * One order, with its payment intent rebuilt.
 *
 * The QR is regenerated here rather than stored, so an order the customer left
 * half-finished yesterday can be reopened and paid today. It is derived
 * entirely from the order and the current payee handle — there is no state to
 * go stale, and a changed VPA correctly produces a QR pointing at the new one.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Bad order id.' }, { status: 400 });

  const { data, error } = await supabaseAdmin().from('payment_orders').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) {
    console.error('[api/payments/:id] read failed:', error.code, error.message);
    return NextResponse.json({ error: 'Could not read the payment order.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'No such payment order.' }, { status: 404 });

  const order = toOrder(data);
  if (!isAdmin(session) && order.crsId !== session.crsId) {
    return NextResponse.json({ error: 'That order belongs to another shop.' }, { status: 403 });
  }

  // Only an order that can still be paid gets a payment intent. Re-issuing a
  // QR for something already approved would invite a second payment for a
  // download the shop already owns.
  const payable = order.status === 'pending' || order.status === 'rejected';
  if (!payable) return NextResponse.json({ order, upi: null });

  const settings = await readSettings();
  if (!settings.upiVpa) return NextResponse.json({ order, upi: null });

  const uri = upiUri({
    vpa: settings.upiVpa,
    payeeName: settings.upiPayeeName || 'TNCSC CRS',
    amountPaise: order.totalPaise,
    reference: order.orderNo,
    note:
      order.kind === 'dss'
        ? `DSS CRS${order.crsId} ${MONTHS[order.month]}${order.year}`
        : `Statements CRS${order.crsId} ${MONTHS[order.month]}${order.year}`,
  });
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 320, errorCorrectionLevel: 'M' }).catch(() => '');

  return NextResponse.json({ order, upi: { uri, qr, vpa: settings.upiVpa, payeeName: settings.upiPayeeName } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Bad order id.' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  const db = supabaseAdmin();
  const { data: existing, error: readErr } = await db.from('payment_orders').select(COLUMNS).eq('id', id).maybeSingle();

  if (readErr) {
    console.error('[api/payments/:id] read failed:', readErr.code, readErr.message);
    return NextResponse.json({ error: 'Could not read the payment order.' }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: 'No such payment order.' }, { status: 404 });

  const order = toOrder(existing);

  // ── Customer: record the UTR ──────────────────────────────────────────────
  if (action === 'submit') {
    if (!isAdmin(session) && order.userId !== session.userId && order.crsId !== session.crsId) {
      return NextResponse.json({ error: 'That order belongs to another shop.' }, { status: 403 });
    }
    if (order.status !== 'pending' && order.status !== 'rejected') {
      return NextResponse.json({ error: `This order is already ${order.status.replace('_', ' ')}.` }, { status: 409 });
    }

    // A UPI reference is 12 digits. Validated because it is the only thing the
    // admin has to match against the bank feed — "paid" typed into the box
    // helps nobody and turns the queue into noise.
    const utr = String(body.utr ?? '').trim();
    if (!/^\d{12}$/.test(utr)) {
      return NextResponse.json(
        { error: 'Enter the 12-digit UPI reference (UTR) shown in your payment app.' },
        { status: 400 },
      );
    }

    const { data, error } = await db
      .from('payment_orders')
      .update({
        status: 'awaiting_approval',
        utr,
        submitted_at: new Date().toISOString(),
        // A rejected order being resubmitted carries the old decision. Clearing
        // it stops the customer's screen showing "rejected by X" next to a
        // request that is now waiting on someone.
        reject_reason: null,
        decided_at: null,
        decided_by: null,
        decided_by_name: null,
      })
      .eq('id', id)
      .in('status', ['pending', 'rejected'])
      .select(COLUMNS)
      .maybeSingle();

    if (error || !data) {
      console.error('[api/payments/:id] submit failed:', error?.code, error?.message);
      return NextResponse.json({ error: 'Could not record the payment reference.' }, { status: 500 });
    }
    return NextResponse.json({ order: toOrder(data) });
  }

  // ── Admin: approve or reject ──────────────────────────────────────────────
  if (action === 'approve' || action === 'reject') {
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Only an administrator can decide a payment.' }, { status: 403 });
    }
    if (order.status !== 'awaiting_approval') {
      return NextResponse.json(
        { error: `Only an order awaiting approval can be decided — this one is ${order.status.replace('_', ' ')}.` },
        { status: 409 },
      );
    }

    const reason = String(body.reason ?? '').trim().slice(0, 300);
    if (action === 'reject' && !reason) {
      return NextResponse.json({ error: 'Give a reason so the customer knows what to fix.' }, { status: 400 });
    }

    const { data, error } = await db
      .from('payment_orders')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        reject_reason: action === 'reject' ? reason : null,
        decided_at: new Date().toISOString(),
        decided_by: session.userId,
        decided_by_name: session.username,
      })
      .eq('id', id)
      // The guard that makes two simultaneous decisions safe.
      .eq('status', 'awaiting_approval')
      .select(COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[api/payments/:id] decision failed:', error.code, error.message);
      return NextResponse.json({ error: 'Could not save the decision.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Someone else decided this order first — reload the queue.' }, { status: 409 });
    }
    return NextResponse.json({ order: toOrder(data) });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
