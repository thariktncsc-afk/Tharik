/**
 * What is this session allowed to open, for one shop-month?
 *
 * Read-only and cheap. The screens call it to decide which buttons to enable;
 * it is a convenience for the UI, never the gate. The gate is re-run inside
 * /api/statements/render, because a disabled button stops nobody.
 */
import { NextResponse } from 'next/server';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import {
  chargingActive,
  dssPaid,
  isAdmin,
  loadStatementEngine,
  paidSections,
  readSettings,
  requireSession,
  sectionsForShop,
} from '@/lib/payments/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const url = new URL(req.url);
  const crsId = Number(url.searchParams.get('crsId'));
  const month = Number(url.searchParams.get('month'));
  const year = Number(url.searchParams.get('year'));

  if (!Number.isFinite(crsId) || crsId < 1 || !Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(year)) {
    return NextResponse.json({ error: 'Bad shop, month or year.' }, { status: 400 });
  }

  const admin = isAdmin(session);
  if (!admin && session.crsId !== crsId) {
    return NextResponse.json({ error: 'You can only open your own shop’s statements.' }, { status: 403 });
  }

  const [settings, charging, engine] = await Promise.all([
    readSettings(),
    chargingActive(),
    loadStatementEngine(null),
  ]);

  // The section list comes from the engine, so CRS 29's twelve-section family
  // prices itself correctly without anything here knowing it is special.
  // Only presentation metadata crosses — never a built statement.
  const sections = sectionsForShop(engine, crsId, admin);

  // Which source modules hold data for this month. Just an indicator, but it
  // has to come from here now: the page no longer carries a statement engine
  // of its own, which is what makes the paywall more than a disabled button.
  let avail: Record<string, boolean | number> = {};
  try {
    avail = engine.getData(crsId, month, year).avail ?? {};
  } catch {
    avail = {};
  }

  // Admin downloads are free and unconditional — that is the requirement, and
  // it is also what keeps the office able to reissue paperwork for a shop
  // whose payment is stuck in the queue.
  const free = admin || !charging;

  const [paid, dss] = free
    ? [new Set<string>(), true]
    : await Promise.all([
        paidSections({ crsId, kind: 'statement', year, month }),
        dssPaid({ crsId, year, month }),
      ]);

  return NextResponse.json({
    free,
    charging,
    isAdmin: admin,
    settings,
    sections,
    avail,
    paidSections: [...paid],
    dssPaid: dss,
  });
}
