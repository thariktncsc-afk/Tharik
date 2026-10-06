/**
 * POST /api/pv/pdf — one shop's PV as a PDF file (office, 2026-10-06).
 *
 * Body: { crsId, paper: 'A4' | 'Legal', period, html } — `html` is the sheet
 * exactly as Reports shows it (pvStatement.ts `buildPVTable`). It is drawn in
 * headless Chrome on its own paper, fitted by the screen's own function
 * (pvFit.ts), and returned as `application/pdf`.
 *
 * Signed in; a shop user only for their own shop. The markup is checked to be
 * a PV sheet for that shop and paper with nothing in it that could run or
 * fetch anything (lib/pvPdf.ts), and the page it is drawn in can reach no
 * network. "All shops" is the browser calling this once per shop — one PV per
 * request keeps each answer small (~250 KB) and quick.
 */
import { NextResponse, after } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { recordActivity } from '@/lib/activityLog/server';
import { pvSheetToPdf } from '@/lib/statements/pdfServer';
import { fitPvSheet } from '@/lib/engine/pvFit';
import { pvFileName, pvSheetProblem } from '@/lib/pvPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { crsId?: unknown; paper?: unknown; period?: unknown; html?: unknown } | null;
  const crsId = Number(body?.crsId);
  const paper = body?.paper === 'Legal' ? 'Legal' : body?.paper === 'A4' ? 'A4' : null;
  const period = typeof body?.period === 'string' ? body.period.slice(0, 80) : '';
  if (!Number.isInteger(crsId) || crsId < 1 || crsId > 99) return NextResponse.json({ error: 'Unknown CRS shop.' }, { status: 400 });
  if (!paper) return NextResponse.json({ error: 'Choose A4 or Legal paper.' }, { status: 400 });
  if (session.role !== 'ADMIN' && Number(session.crsId) !== crsId) {
    return NextResponse.json({ error: `You can only download CRS ${session.crsId}'s PV.` }, { status: 403 });
  }
  const problem = pvSheetProblem(body?.html, { crsId, paper });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  let pdf: Uint8Array;
  try {
    pdf = await pvSheetToPdf(body!.html as string, fitPvSheet.toString());
  } catch (e) {
    console.error('[api/pv/pdf]', e);
    return NextResponse.json({ error: 'The PDF could not be made. Please try again.' }, { status: 500 });
  }
  const name = pvFileName(crsId, period, paper);
  after(() =>
    recordActivity(session, [
      {
        crsId,
        module: 'Reports',
        action: 'exported',
        source: 'user',
        recordKey: `pv-pdf:${crsId}`,
        summary: `PV PDF downloaded — CRS ${crsId}, ${period || 'PV'}, ${paper} landscape`,
      },
    ]),
  );
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
