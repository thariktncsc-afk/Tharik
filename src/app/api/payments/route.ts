/**
 * Fee orders: list them, and raise a new one.
 *
 * The amount is computed here from the settings row and the request's own
 * contents. Nothing about the price is read from the request body — a client
 * that posts `total: 1` gets charged the real tariff, because the only inputs
 * this route takes are *what* is being bought, never *for how much*.
 */
import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import {
  chargingActive,
  isAdmin,
  loadStatementEngine,
  paidSections,
  readSettings,
  requireSession,
  sectionsForShop,
} from '@/lib/payments/server';
import { quoteDss, quoteStatement } from '@/lib/payments/pricing';
import { upiUri } from '@/lib/payments/upi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const COLUMNS =
  'id, order_no, user_id, username, full_name, crs_id, kind, month, year, section_ids, sheet_count, day_count, base_paise, gst_paise, total_paise, gst_rate_bp, gst_inclusive, status, utr, reject_reason, created_at, submitted_at, decided_at, decided_by_name';

type Row = Record<string, unknown>;

export function toOrder(r: Row) {
  return {
    id: r.id as number,
    orderNo: r.order_no as string,
    userId: r.user_id as number,
    username: (r.username as string) ?? '',
    fullName: (r.full_name as string) ?? '',
    crsId: r.crs_id as number,
    kind: r.kind as 'statement' | 'dss',
    month: r.month as number,
    year: r.year as number,
    sectionIds: (r.section_ids as string[]) ?? [],
    sheetCount: (r.sheet_count as number) ?? 0,
    dayCount: (r.day_count as number) ?? 0,
    basePaise: r.base_paise as number,
    gstPaise: r.gst_paise as number,
    totalPaise: r.total_paise as number,
    gstRateBp: r.gst_rate_bp as number,
    gstInclusive: r.gst_inclusive === true,
    status: r.status as 'pending' | 'awaiting_approval' | 'approved' | 'rejected',
    utr: (r.utr as string) ?? '',
    rejectReason: (r.reject_reason as string) ?? '',
    createdAt: r.created_at as string,
    submittedAt: (r.submitted_at as string) ?? null,
    decidedAt: (r.decided_at as string) ?? null,
    decidedByName: (r.decided_by_name as string) ?? '',
  };
}

function tableMissing(error: { code?: string }) {
  return error.code === 'PGRST205' || error.code === '42P01';
}

const missingResponse = () =>
  NextResponse.json(
    { error: 'The payment tables do not exist — run supabase/migrations/0004_payments.sql.' },
    { status: 503 },
  );

// ── List ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  let q = supabaseAdmin().from('payment_orders').select(COLUMNS).order('created_at', { ascending: false }).limit(200);

  // A shop user sees their own shop's orders and nothing else. The filter is
  // applied server-side rather than trusting a crsId query parameter.
  if (!isAdmin(session)) {
    if (session.crsId == null) return NextResponse.json({ orders: [] });
    q = q.eq('crs_id', session.crsId);
  }
  if (status && status !== 'all') q = q.eq('status', status);

  const { data, error } = await q;
  if (error) {
    if (tableMissing(error)) return missingResponse();
    console.error('[api/payments] list failed:', error.code, error.message);
    return NextResponse.json({ error: 'Could not read payment orders.' }, { status: 500 });
  }

  return NextResponse.json({ orders: (data ?? []).map(toOrder) });
}

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * Days in this shop-month that actually have a daily entry.
 *
 * The DSS export writes one sheet per day with entries, so the fee follows the
 * same set. Counting calendar days instead would bill for blank sheets that
 * never reach the file.
 */
async function daysWithEntries(crsId: number, year: number, month: number): Promise<number> {
  const { data } = await supabaseAdmin()
    .from('crs_state')
    .select('data')
    .eq('scope', 'global')
    .eq('store_key', 'entryStore')
    .maybeSingle();

  const store = (data?.data as Record<string, unknown>) ?? {};
  const prefix = `${crsId}_${year}-${String(month).padStart(2, '0')}-`;
  return Object.keys(store).filter((k) => k.startsWith(prefix)).length;
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  if (isAdmin(session)) {
    return NextResponse.json({ error: 'Administrator downloads are free — no payment is needed.' }, { status: 400 });
  }
  if (session.crsId == null) {
    return NextResponse.json({ error: 'This account is not attached to a shop.' }, { status: 403 });
  }
  if (!(await chargingActive())) {
    return NextResponse.json({ error: 'Downloads are not being charged for at the moment.' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = body.kind === 'dss' ? 'dss' : 'statement';
  const crsId = session.crsId;
  const month = Math.trunc(Number(body.month));
  const year = Math.trunc(Number(body.year));

  if (!Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(year) || year < 2000 || year > 2200) {
    return NextResponse.json({ error: 'Bad month or year.' }, { status: 400 });
  }

  const settings = await readSettings();
  let sectionIds: string[] = [];
  let sheetCount = 0;
  let dayCount = 0;
  let quote;

  if (kind === 'statement') {
    const engine = await loadStatementEngine(null);
    const allowed = new Set(sectionsForShop(engine, crsId, false).map((s) => s.id));
    const asked = Array.isArray(body.sectionIds) ? (body.sectionIds as unknown[]).map(String) : [];

    const unknown = asked.filter((id) => !allowed.has(id));
    if (unknown.length) {
      return NextResponse.json({ error: `Not a statement for this shop: ${unknown.join(', ')}` }, { status: 400 });
    }

    // Already-approved sheets are dropped rather than rejected: a customer who
    // re-selects last week's paid sheets alongside three new ones should be
    // billed for three, not turned away or charged twice.
    const already = await paidSections({ crsId, kind: 'statement', year, month });
    sectionIds = [...new Set(asked)].filter((id) => !already.has(id));

    if (!sectionIds.length) {
      return NextResponse.json(
        { error: 'Every sheet selected is already paid for — no new payment is needed.' },
        { status: 400 },
      );
    }
    sheetCount = sectionIds.length;
    quote = quoteStatement(sheetCount, settings);
  } else {
    dayCount = await daysWithEntries(crsId, year, month);
    if (!dayCount) {
      return NextResponse.json(
        { error: `No daily entries exist for ${MONTHS[month]} ${year}, so there is nothing to download.` },
        { status: 400 },
      );
    }
    quote = quoteDss(dayCount, settings);
  }

  if (quote.totalPaise <= 0) {
    return NextResponse.json({ error: 'The tariff works out to zero — check the payment settings.' }, { status: 400 });
  }

  // Denormalised onto the order so the admin queue still reads correctly after
  // a rename or a deactivation — the session cookie only carries the username.
  const { data: who } = await supabaseAdmin()
    .from('users')
    .select('full_name')
    .eq('id', session.userId)
    .maybeSingle();

  const { data, error } = await supabaseAdmin()
    .from('payment_orders')
    .insert({
      user_id: session.userId,
      username: session.username,
      full_name: (who?.full_name as string) ?? session.username,
      crs_id: crsId,
      kind,
      month,
      year,
      section_ids: sectionIds,
      sheet_count: sheetCount,
      day_count: dayCount,
      base_paise: quote.basePaise,
      gst_paise: quote.gstPaise,
      total_paise: quote.totalPaise,
      gst_rate_bp: quote.gstRateBp,
      gst_inclusive: quote.gstInclusive,
      status: 'pending',
    })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    if (error && tableMissing(error)) return missingResponse();
    console.error('[api/payments] create failed:', error?.code, error?.message);
    return NextResponse.json({ error: 'Could not raise the payment order.' }, { status: 500 });
  }

  const order = toOrder(data);
  const uri = upiUri({
    vpa: settings.upiVpa,
    payeeName: settings.upiPayeeName || 'TNCSC CRS',
    amountPaise: order.totalPaise,
    reference: order.orderNo,
    note: kind === 'dss'
      ? `DSS CRS${crsId} ${MONTHS[month]}${year}`
      : `Statements CRS${crsId} ${MONTHS[month]}${year}`,
  });

  // The QR is rendered server-side so the page never has to reach a CDN for a
  // library — these shops run on patchy connections, and a QR that silently
  // fails to draw looks identical to one nobody has paid.
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 320, errorCorrectionLevel: 'M' }).catch(() => '');

  return NextResponse.json({ order, upi: { uri, qr, vpa: settings.upiVpa, payeeName: settings.upiPayeeName } });
}
