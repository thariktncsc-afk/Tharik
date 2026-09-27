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
import { requireSession } from '@/lib/payments/server';
import { buildStatements } from '@/lib/statements/renderServer';
import { documentDraft } from '@/lib/activityLog/core';
import { recordActivity } from '@/lib/activityLog/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Validation, the paywall and the build itself live in renderServer.ts,
  // shared with /api/statements/pdf so both run the one gate.
  const built = await buildStatements(session, body);
  if (!built.ok) {
    return NextResponse.json({ error: built.error, ...(built.unpaid ? { unpaid: built.unpaid } : {}) }, { status: built.status });
  }
  const { crsId, month, year, sections } = built;

  // Opening a statement is itself an action the office accounts for: who
  // looked at, printed or exported which shop's month (activityLog/core.ts).
  const purpose = body.purpose === 'print' ? 'printed' : body.purpose === 'excel' ? 'exported' : 'viewed';
  await recordActivity(session, [documentDraft({ module: 'Statements', action: purpose, crsId, month, year, sections: sections.map((s) => s.label) })]);

  return NextResponse.json({
    css: built.css,
    period: built.period,
    free: built.free,
    sections,
  });
}
