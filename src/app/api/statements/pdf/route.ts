/**
 * The selected statements as ONE PDF — for Print and for the PDF download
 * (office, 2026-09-27).
 *
 * Same gate as /api/statements/render: `buildStatements` (renderServer.ts)
 * validates, authorises and builds, and nothing is produced for a statement
 * the shop has not paid for. The sheets are then assembled into the print
 * document exactly as the preview and the old print window assembled them
 * (buildPrintDocument), and that document is printed to PDF in headless
 * Chrome (pdfServer.ts) — every sheet on A4 in its own orientation, in the
 * order ticked, each two-copy statement twice. The browser then prints that
 * one file in one session.
 */
import { NextResponse } from 'next/server';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { requireSession } from '@/lib/payments/server';
import { buildStatements } from '@/lib/statements/renderServer';
import { buildPrintDocument } from '@/lib/statements/printDoc';
import { htmlToPdf } from '@/lib/statements/pdfServer';
import { documentDraft } from '@/lib/activityLog/core';
import { recordActivity } from '@/lib/activityLog/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A cold start unpacks Chrome before the first page; give it room.
export const maxDuration = 60;

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const built = await buildStatements(session, body);
  if (!built.ok) {
    return NextResponse.json({ error: built.error, ...(built.unpaid ? { unpaid: built.unpaid } : {}) }, { status: built.status });
  }
  const { crsId, month, year, sections } = built;

  const title = `TNCSC Statements - CRS ${crsId} ${MONTHS[month]} ${year}`;
  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(buildPrintDocument(title, built.css, sections));
  } catch (e) {
    console.error('[api/statements/pdf] PDF failed:', e);
    return NextResponse.json({ error: 'Could not prepare the statements for printing. Please try again.' }, { status: 500 });
  }

  const download = body.purpose === 'download';
  await recordActivity(session, [
    documentDraft({ module: 'Statements', action: download ? 'exported' : 'printed', crsId, month, year, sections: sections.map((s) => s.label) }),
  ]);

  const file = `CRS${crsId}-${MONTHS[month]}-${year}-statements.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  });
}
