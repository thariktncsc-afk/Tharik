/**
 * GET /api/statements/reconcile?crsId=&month=&year= — the month's
 * reconciliation (office, 2026-09-30): Expected (POS + TEA/SALT + Police +
 * C.Box/Poly) against the actual remittance, with the reasons when it is short.
 *
 * Built by the same statement engine, from the same saved stores, as the
 * statements themselves (loadStatementEngine rebuilds the month on every
 * call — nothing cached), so the Statements page and Monthly Remittance show
 * exactly the Excess the paper prints. A shop user may ask only for their own
 * shop; no statement is returned, so the statement payment gate does not apply.
 */
import { NextResponse } from 'next/server';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { isAdmin, loadStatementEngine, requireSession } from '@/lib/payments/server';
import { reconcileMessage, reconcileReasons, type Reconcile } from '@/lib/statements/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const crsId = Math.trunc(Number(q.get('crsId')));
  const month = Math.trunc(Number(q.get('month')));
  const year = Math.trunc(Number(q.get('year')));
  if (!(crsId >= 1 && crsId <= 30) || !(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
    return NextResponse.json({ error: 'Bad shop, month or year.' }, { status: 400 });
  }
  if (!isAdmin(session) && Number(session.crsId) !== crsId) {
    return NextResponse.json({ error: 'That is not your shop.' }, { status: 403 });
  }
  const engine = await loadStatementEngine({ id: session.userId, username: session.username, role: session.role, crsId: session.crsId });
  const r = engine.reconcile(engine.getData(crsId, month, year)) as (Reconcile & { expectedRaw?: number }) | null;
  if (!r) return NextResponse.json({ reconcile: null });
  const { expectedRaw: _raw, ...rest } = r;
  return NextResponse.json({ reconcile: { ...rest, reasons: reconcileReasons(rest), message: reconcileMessage(rest) } });
}
