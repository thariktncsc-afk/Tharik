/**
 * Statement rendering — and the only place the paywall is actually enforced.
 *
 * The sheets used to be built in the browser from stores it already held, so
 * any gate in React was advisory: the export was one devtools call away. The
 * builders now run here, against the database, and nothing is generated until
 * authorise() has said yes for the exact sections asked for.
 *
 * Preview, print and Excel all come through this one route because they are
 * the same document. Gating only the download would have collected nothing —
 * Print → Save as PDF produces the identical file for free.
 *
 * The builders themselves are untouched legacy code (src/generated/
 * statements-legacy.js, verified byte-for-byte against golden/statements by
 * tools/verify-statements.mjs). Moving where they run does not move what they
 * produce, which is the point: these are statutory documents.
 */
import { NextResponse } from 'next/server';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { authorise, isAdmin, loadStatementEngine, requireSession, sectionsForShop } from '@/lib/payments/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const crsId = Math.trunc(Number(body.crsId));
  const month = Math.trunc(Number(body.month));
  const year = Math.trunc(Number(body.year));
  const asked = Array.isArray(body.sectionIds) ? [...new Set((body.sectionIds as unknown[]).map(String))] : [];

  if (!Number.isFinite(crsId) || crsId < 1 || !Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(year)) {
    return NextResponse.json({ error: 'Bad shop, month or year.' }, { status: 400 });
  }
  if (!asked.length) {
    return NextResponse.json({ error: 'Select at least one statement.' }, { status: 400 });
  }
  // A ceiling on the fan-out. Each section is a full statement build, and the
  // list of sections is small and known, so anything past it is abuse.
  if (asked.length > 40) {
    return NextResponse.json({ error: 'Too many statements in one request.' }, { status: 400 });
  }

  const admin = isAdmin(session);

  // Authorise BEFORE building anything. Generating the sheets and then
  // deciding whether to return them would still burn the work, and one
  // forgotten early return would leak the document.
  const verdict = await authorise(session, { crsId, kind: 'statement', year, month }, asked);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error, unpaid: verdict.unpaid ?? [] }, { status: verdict.status });
  }

  const engine = await loadStatementEngine({
    id: session.userId,
    username: session.username,
    role: session.role,
    crsId: session.crsId,
  });

  // Re-derive what this shop is even allowed to ask for. The `coll` section is
  // admin-only; a shop user must not be able to reach it by naming it, paid or
  // not.
  const available = sectionsForShop(engine, crsId, admin);
  const byId = new Map(available.map((s) => [s.id, s]));
  const forbidden = asked.filter((id) => !byId.has(id));
  if (forbidden.length) {
    return NextResponse.json({ error: `Not available for this shop: ${forbidden.join(', ')}` }, { status: 403 });
  }

  let data;
  try {
    data = engine.getData(crsId, month, year);
  } catch (e) {
    console.error('[api/statements/render] getData failed:', e);
    return NextResponse.json({ error: 'Could not assemble this month’s figures.' }, { status: 500 });
  }

  const sections = [];
  for (const id of asked) {
    const meta = byId.get(id)!;
    try {
      sections.push({ id, label: meta.label, copies: meta.copies, html: engine.buildSection(id, data) });
    } catch (e) {
      console.error(`[api/statements/render] section ${id} failed:`, e);
      return NextResponse.json({ error: `Could not build the ${meta.label} statement.` }, { status: 500 });
    }
  }

  return NextResponse.json({
    css: engine.printCss,
    period: { mo: data.mo, yr: data.yr },
    free: verdict.free,
    sections,
  });
}
