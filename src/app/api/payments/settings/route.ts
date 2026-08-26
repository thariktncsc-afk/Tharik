/**
 * Payment configuration — the payee handle and the tariff.
 *
 * GET is open to any signed-in user: a customer cannot pay without knowing the
 * VPA and the price. PUT is admin-only, because whoever can write upi_vpa can
 * redirect every rupee this app collects. That asymmetry is the whole reason
 * these fields live in their own table instead of in `__config`, which any
 * signed-in user can write through /api/state.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { readSettings, requireSession } from '@/lib/payments/server';
import { looksLikeVpa } from '@/lib/payments/upi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  return NextResponse.json({ settings: await readSettings() });
}

export async function PUT(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only an administrator can change payment settings.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const vpa = String(body.upiVpa ?? '').trim();
  const enabled = body.enabled === true;

  // Switching charging on without a payee is the one combination that would
  // lock every shop out of its statements with no way to pay, so it is refused
  // rather than saved and left for someone to notice.
  if (enabled && !looksLikeVpa(vpa)) {
    return NextResponse.json(
      { error: 'Enter a valid UPI ID (for example office@okaxis) before switching charging on.' },
      { status: 400 },
    );
  }

  const int = (v: unknown, fallback: number, max: number) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
  };

  const patch = {
    enabled,
    upi_vpa: vpa,
    upi_payee_name: String(body.upiPayeeName ?? '').trim().slice(0, 80),
    statement_sheet_paise: int(body.statementSheetPaise, 4000, 10_000_00),
    dss_day_paise: int(body.dssDayPaise, 500, 10_000_00),
    gst_rate_bp: int(body.gstRateBp, 1800, 10000),
    updated_at: new Date().toISOString(),
    updated_by: session.username,
  };

  const { error } = await supabaseAdmin().from('payment_settings').upsert({ id: 1, ...patch });

  if (error) {
    console.error('[api/payments/settings] save failed:', error.code, error.message);
    const missing = error.code === 'PGRST205';
    return NextResponse.json(
      {
        error: missing
          ? 'The payment_settings table does not exist — run supabase/migrations/0004_payments.sql.'
          : 'Could not save payment settings.',
      },
      { status: missing ? 503 : 500 },
    );
  }

  return NextResponse.json({ settings: await readSettings() });
}
